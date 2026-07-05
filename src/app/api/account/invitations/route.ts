// ============================================================
// /api/account/invitations
//
//   GET  — list outstanding (un-redeemed, non-expired) invites.
//   POST — create a new invite link.
//
// Both admin+. The list endpoint is what the Members tab uses to
// populate the "Pending invitations" section; create is what the
// "Invite member" dialog calls.
//
// IMPORTANT: the plaintext token is returned exactly ONCE — in
// the POST response. We store only the SHA-256 hash on the row,
// so neither GET nor a future PATCH can ever resurface the
// link. The admin sees it in the creation modal, copies it, and
// shares it via WhatsApp/Slack/whatever they like. If they
// dismiss the modal without copying, the only recourse is to
// revoke and re-issue.
// ============================================================

import { NextResponse } from "next/server";

import {
  requireRole,
  requireWithinLimit,
  toErrorResponse,
} from "@/lib/auth/account";
import { clampExpiryDays, inviteExpiresAt } from "@/lib/auth/invitations";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isAccountRole } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/audit/record";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

// Resolve the base URL we publish invite links under.
//
// Resolution order, first match wins:
//
//   1. `NEXT_PUBLIC_SITE_URL` — admin's explicit config. Trumps
//      everything; if you set this, that's where links point.
//   2. `X-Forwarded-Host` (+ `X-Forwarded-Proto`) — set by every
//      reverse proxy in front of the app: Hostinger Managed
//      Node.js, Vercel, Cloudflare, nginx. This is what makes
//      invite links Just Work in production without forcing the
//      operator to set an env var.
//   3. `Host` header + the protocol the request arrived on —
//      bare deployments without a proxy.
//   4. Last-resort marketing-site fallback. Only hit if the
//      request has no Host header at all, which is essentially
//      impossible from a real browser. Logs a warning so the
//      operator can spot the misconfig.
//
// Defense-in-depth: `ALLOWED_INVITE_HOSTS`
//
//   The request-header path (#2 and #3 above) trusts whatever
//   hostname the client (or proxy) puts in the header. On a
//   typical proxied deploy (Vercel / Hostinger / Cloudflare) the
//   proxy overwrites these so they're trustworthy. On a bare
//   deployment exposed to the public internet, an attacker could
//   POST directly with a crafted `Host: phishing.example` and
//   receive an invite URL pointing at their site.
//
//   When `ALLOWED_INVITE_HOSTS` is set (comma-separated hostnames),
//   we validate the derived host against the list. Anything not
//   on the list falls through to the wacrm.tech fallback with a
//   loud console.warn. Operators who care about this attack
//   surface should set this to their canonical hostnames; everyone
//   else gets today's permissive behavior.
//
// Previous implementation hard-defaulted to `https://wacrm.tech`
// (the docs/marketing site, a different repo). Forks that didn't
// set `NEXT_PUBLIC_SITE_URL` got invite links pointing at the
// marketing site, which 404s on `/join/<token>`. This resolution
// chain removes the foot-gun.
function parseAllowedHosts(): readonly string[] | null {
  const raw = process.env.ALLOWED_INVITE_HOSTS?.trim();
  if (!raw) return null;
  const list = raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

function isHostAllowed(
  hostname: string,
  allowList: readonly string[] | null,
): boolean {
  if (!allowList) return true; // No allow-list → permissive (legacy behavior).
  return allowList.includes(hostname.toLowerCase());
}

function getBaseUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const allowList = parseAllowedHosts();
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  if (forwardedHost && isHostAllowed(forwardedHost, allowList)) {
    return `${forwardedProto || "https"}://${forwardedHost}`;
  }

  const host = request.headers.get("host")?.trim();
  if (host && isHostAllowed(host, allowList)) {
    // The protocol on `request.url` is whatever the framework saw —
    // reliable for bare deployments where no proxy is rewriting it.
    const reqProto = new URL(request.url).protocol.replace(":", "");
    return `${reqProto}://${host}`;
  }

  // We fall through here when EITHER no Host header was present at
  // all (essentially impossible from a real browser) OR an
  // ALLOWED_INVITE_HOSTS list was set and neither candidate matched
  // it. The warning is the operator's signal that someone is
  // probing the API with a spoofed Host header.
  if (allowList && (forwardedHost || host)) {
    console.warn(
      "[POST /api/account/invitations] rejected non-allow-listed host:",
      { forwardedHost, host, allowList },
    );
  } else {
    console.warn(
      "[POST /api/account/invitations] could not derive base URL from request; falling back to marketing domain",
    );
  }
  return "https://wacrm.tech";
}

const MAX_LABEL_LEN = 80;
// Pragmatic email check — Supabase re-validates on send; this just fails
// obviously-bad input fast with a clear message.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  try {
    const ctx = await requireRole("admin");

    const { data, error } = await ctx.supabase
      .from("account_invitations")
      .select(
        "id, email, role, label, created_by_user_id, created_at, expires_at, accepted_at, accepted_by_user_id",
      )
      .eq("account_id", ctx.accountId)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[GET /api/account/invitations] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load invitations" },
        { status: 500 },
      );
    }

    return NextResponse.json({ invitations: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");

    // 30/min per user. The Members tab is a clicks-only UI so any
    // legitimate admin is far below this; the cap exists to keep
    // a script run in a loop or a compromised admin session from
    // flooding `account_invitations` with rows.
    const limit = checkRateLimit(
      `admin:inviteCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    // Seat gate: existing members + still-pending invites must be under the
    // plan's seat cap before we add another (block-new, never retroactive).
    const [{ count: memberCount }, { count: pendingCount }] = await Promise.all([
      ctx.supabase
        .from("profiles")
        .select("user_id", { count: "exact", head: true })
        .eq("account_id", ctx.accountId),
      ctx.supabase
        .from("account_invitations")
        .select("id", { count: "exact", head: true })
        .eq("account_id", ctx.accountId)
        .is("accepted_at", null)
        .gt("expires_at", new Date().toISOString()),
    ]);
    requireWithinLimit(
      ctx,
      "seats",
      (memberCount ?? 0) + (pendingCount ?? 0),
      "team seats",
    );

    const body = (await request.json().catch(() => null)) as
      | { email?: unknown; role?: unknown; name?: unknown; expiresInDays?: unknown }
      | null;

    const role = body?.role;
    if (!isAccountRole(role) || role === "owner") {
      return NextResponse.json(
        { error: "'role' must be one of admin, agent, viewer" },
        { status: 400 },
      );
    }

    // Email is required and pinned — only this address can accept.
    const rawEmail = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!EMAIL_RE.test(rawEmail)) {
      return NextResponse.json(
        { error: "A valid email address is required" },
        { status: 400 },
      );
    }
    const email = rawEmail;

    let name: string | null = null;
    if (typeof body?.name === "string") {
      const trimmed = body.name.trim();
      if (trimmed.length > MAX_LABEL_LEN) {
        return NextResponse.json(
          { error: `Name must be ${MAX_LABEL_LEN} characters or fewer` },
          { status: 400 },
        );
      }
      name = trimmed === "" ? null : trimmed;
    }

    const expiresInDaysRaw = body?.expiresInDays;
    const expiresInDays =
      typeof expiresInDaysRaw === "number" ? expiresInDaysRaw : undefined;
    const expiryDays = clampExpiryDays(expiresInDays);
    const expiresAt = inviteExpiresAt(expiryDays);

    // Already a member of THIS account? (RLS-scoped read.)
    const { data: existingMember } = await ctx.supabase
      .from("profiles")
      .select("user_id")
      .eq("account_id", ctx.accountId)
      .ilike("email", email)
      .maybeSingle();
    if (existingMember) {
      return NextResponse.json(
        { error: "That email is already a member of this account." },
        { status: 409 },
      );
    }

    // A pending (un-accepted, non-expired) invite for this email already?
    const { data: pending } = await ctx.supabase
      .from("account_invitations")
      .select("id")
      .eq("account_id", ctx.accountId)
      .ilike("email", email)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (pending) {
      return NextResponse.json(
        { error: "An invitation is already pending for that email. Revoke it first to re-send." },
        { status: 409 },
      );
    }

    // Send the Supabase native invite email. The account + role travel in
    // user_metadata; handle_new_user (migration 044) reads them to attach
    // the new user to this account with this role. The email links to
    // /accept-invite where they set a password.
    const admin = supabaseAdmin();
    const { data: invited, error: inviteErr } =
      await admin.auth.admin.inviteUserByEmail(email, {
        data: {
          invited_account_id: ctx.accountId,
          invited_account_role: role,
          invited_by: ctx.userId,
          full_name: name ?? "",
        },
        redirectTo: `${getBaseUrl(request)}/accept-invite`,
      });

    if (inviteErr || !invited?.user) {
      const msg = inviteErr?.message ?? "Failed to send invitation";
      // The most common cause: the email already has an auth account on
      // this instance (signed up or invited before).
      const alreadyExists = /already|registered|exists/i.test(msg);
      console.error("[POST /api/account/invitations] inviteUserByEmail:", msg);
      return NextResponse.json(
        {
          error: alreadyExists
            ? "That email already has an account on this instance."
            : `Couldn't send the invitation: ${msg}`,
        },
        { status: alreadyExists ? 409 : 502 },
      );
    }

    // Record the pending invite (for the Members list + revoke). token_hash
    // is null — email invites use Supabase's own link, not our token.
    const { data: row, error: insertErr } = await ctx.supabase
      .from("account_invitations")
      .insert({
        account_id: ctx.accountId,
        email,
        invited_user_id: invited.user.id,
        role,
        created_by_user_id: ctx.userId,
        label: name,
        expires_at: expiresAt.toISOString(),
      })
      .select("id, email, role, label, expires_at, created_at")
      .single();

    if (insertErr || !row) {
      // The email went out but we couldn't record it — roll back the
      // pending auth user so a re-invite isn't blocked by "already exists".
      console.error("[POST /api/account/invitations] insert error:", insertErr);
      await admin.auth.admin.deleteUser(invited.user.id).catch(() => {});
      return NextResponse.json(
        { error: "Failed to record the invitation" },
        { status: 500 },
      );
    }

    recordAudit({
      accountId: ctx.accountId,
      actorUserId: ctx.userId,
      action: "invitation.created",
      entityType: "invitation",
      entityId: row.id,
      metadata: { role, email },
    });

    return NextResponse.json(
      { invitation: row, email, expiresInDays: expiryDays },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
