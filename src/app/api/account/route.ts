// ============================================================
// /api/account
//
//   GET    — current caller's account + role.       Any member.
//   PATCH  — rename the account.                     Admin+.
//   DELETE — permanently delete the account + all    Owner only.
//            its data and every member's login.
//
// Why these verbs share a route file
//   They speak about the same singular resource (the caller's
//   account) and reuse the same `requireRole` plumbing. Splitting
//   them across files would duplicate the `account_id` lookup
//   without buying anything.
// ============================================================

import { NextResponse } from "next/server";

import {
  requireRole,
  getCurrentAccount,
  toErrorResponse,
} from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    return NextResponse.json({
      account: ctx.account,
      role: ctx.role,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const MAX_NAME_LEN = 80;

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("admin");

    // Per-user limit on admin-class mutations. Bounds accidental
    // abuse (script run in a loop) and a compromised admin session
    // spamming renames. Each admin endpoint keys its own bucket so
    // one route doesn't starve another.
    const limit = checkRateLimit(
      `admin:rename:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown }
      | null;
    const rawName = body?.name;

    if (typeof rawName !== "string") {
      return NextResponse.json(
        { error: "'name' must be a string" },
        { status: 400 },
      );
    }

    const name = rawName.trim();
    if (name.length === 0) {
      return NextResponse.json(
        { error: "Account name cannot be empty" },
        { status: 400 },
      );
    }
    if (name.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: `Account name must be ${MAX_NAME_LEN} characters or fewer` },
        { status: 400 },
      );
    }

    // RLS allows this UPDATE because accounts_update requires
    // `is_account_member(id, 'admin')`, and requireRole already
    // guaranteed the caller is admin+.
    const { data, error } = await ctx.supabase
      .from("accounts")
      .update({ name })
      .eq("id", ctx.accountId)
      .select("id, name")
      .single();

    if (error) {
      console.error("[PATCH /api/account] update error:", error);
      return NextResponse.json(
        { error: "Failed to update account" },
        { status: 500 },
      );
    }

    return NextResponse.json({ account: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// ============================================================
// DELETE /api/account — permanent, irreversible account teardown.
//
// Owner only. Deletes the account row, which cascades to every
// account-scoped table (contacts, conversations, messages, deals,
// broadcasts, automations, flows, AI config/KB, api keys, member
// profiles, …) — all their `account_id` FKs are ON DELETE CASCADE.
// It then erases each member's `auth.users` identity.
//
// Why delete every member, not just the owner
//   In this app a user belongs to exactly one account (profiles is
//   UNIQUE(user_id), created by the signup trigger). Once the
//   account is gone, a member's auth login has no profile to attach
//   to and can do nothing — an orphan. A clean teardown removes them
//   too, which is also what a GDPR erasure of the tenant requires.
//
// Confirmation
//   The caller must POST `{ confirm: "<exact account name>" }`.
//   This is the GitHub "type the repo name" pattern — it makes an
//   irreversible destructive action impossible to trigger by a
//   stray click or a mis-fired request.
//
// Privilege
//   Uses the service-role client: deleting rows across every
//   account member (not just auth.uid()) is beyond what the caller's
//   RLS-scoped session can do, and deleting `auth.users` needs the
//   admin API. Owner identity is proven by `requireRole('owner')`
//   BEFORE any service-role call runs.
// ============================================================
export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole("owner");

    // Tightly rate-limited: a legitimate owner deletes their account
    // at most once, ever. This bounds a compromised owner session or
    // a scripted mistake.
    const limit = checkRateLimit(
      `admin:deleteAccount:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { confirm?: unknown }
      | null;

    if (typeof body?.confirm !== "string" || body.confirm !== ctx.account.name) {
      return NextResponse.json(
        {
          error:
            "To confirm deletion, 'confirm' must exactly match the account name.",
        },
        { status: 400 },
      );
    }

    const admin = supabaseAdmin();

    // Snapshot every member's user_id BEFORE the delete — their
    // profiles cascade away with the account, so we can't read them
    // afterwards.
    const { data: members, error: membersErr } = await admin
      .from("profiles")
      .select("user_id")
      .eq("account_id", ctx.accountId);

    if (membersErr) {
      console.error("[DELETE /api/account] member fetch error:", membersErr);
      return NextResponse.json(
        { error: "Failed to delete account" },
        { status: 500 },
      );
    }

    // Delete the account → cascades all account-scoped data + profiles.
    const { error: delErr } = await admin
      .from("accounts")
      .delete()
      .eq("id", ctx.accountId);

    if (delErr) {
      console.error("[DELETE /api/account] account delete error:", delErr);
      return NextResponse.json(
        { error: "Failed to delete account" },
        { status: 500 },
      );
    }

    // Erase each member's auth identity. Best-effort: the tenant data
    // is already gone, so a failed user delete leaves at worst an
    // orphaned login (no profile, no access), not a data leak. Log any
    // failures so an operator can clean them up.
    const userIds = (members ?? []).map((m) => m.user_id as string);
    const results = await Promise.allSettled(
      userIds.map((id) => admin.auth.admin.deleteUser(id)),
    );
    const failed = results.filter(
      (r) => r.status === "rejected" || (r.value && r.value.error),
    ).length;
    if (failed > 0) {
      console.error(
        `[DELETE /api/account] ${failed}/${userIds.length} auth user deletions failed`,
      );
    }

    return NextResponse.json({ ok: true, membersRemoved: userIds.length });
  } catch (err) {
    return toErrorResponse(err);
  }
}
