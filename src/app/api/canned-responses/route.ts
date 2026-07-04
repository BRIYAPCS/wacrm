// ============================================================
// /api/canned-responses
//   GET  — list the account's saved replies.       Any member.
//   POST — create a saved reply.                    Agent+.
// ============================================================

import { NextResponse } from "next/server";

import {
  requireRole,
  getCurrentAccount,
  toErrorResponse,
} from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

const SHORTCUT_RE = /^[a-zA-Z0-9_-]+$/;
const LIMITS = { shortcut: 40, title: 80, content: 4096 };

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data, error } = await ctx.supabase
      .from("canned_responses")
      .select("id, shortcut, title, content, created_by, updated_at")
      .order("shortcut", { ascending: true });
    if (error) {
      console.error("[GET /api/canned-responses]", error);
      return NextResponse.json({ error: "Failed to load saved replies" }, { status: 500 });
    }
    return NextResponse.json({ canned_responses: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Validate + normalize a create/update body. Returns the clean fields
 *  or an error string. Shared by POST here and PATCH in [id]. */
export function parseCannedBody(body: unknown):
  | { ok: true; shortcut: string; title: string; content: string }
  | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const shortcut = typeof b.shortcut === "string" ? b.shortcut.trim() : "";
  const title = typeof b.title === "string" ? b.title.trim() : "";
  const content = typeof b.content === "string" ? b.content : "";

  if (!shortcut) return { ok: false, error: "A shortcut is required." };
  if (shortcut.length > LIMITS.shortcut)
    return { ok: false, error: `Shortcut must be ${LIMITS.shortcut} characters or fewer.` };
  if (!SHORTCUT_RE.test(shortcut))
    return { ok: false, error: "Shortcut may only contain letters, numbers, hyphens, and underscores." };
  if (!title) return { ok: false, error: "A title is required." };
  if (title.length > LIMITS.title)
    return { ok: false, error: `Title must be ${LIMITS.title} characters or fewer.` };
  if (!content.trim()) return { ok: false, error: "Message content is required." };
  if (content.length > LIMITS.content)
    return { ok: false, error: `Content must be ${LIMITS.content} characters or fewer.` };

  return { ok: true, shortcut, title, content };
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const limit = checkRateLimit(`cannedWrite:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const parsed = parseCannedBody(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const { data, error } = await ctx.supabase
      .from("canned_responses")
      .insert({
        account_id: ctx.accountId,
        created_by: ctx.userId,
        shortcut: parsed.shortcut,
        title: parsed.title,
        content: parsed.content,
      })
      .select("id, shortcut, title, content, created_by, updated_at")
      .single();

    if (error) {
      // 23505 — the case-insensitive unique index on (account_id, shortcut).
      if (error.code === "23505") {
        return NextResponse.json(
          { error: `A saved reply with the shortcut "/${parsed.shortcut}" already exists.` },
          { status: 409 },
        );
      }
      console.error("[POST /api/canned-responses]", error);
      return NextResponse.json({ error: "Failed to create saved reply" }, { status: 500 });
    }

    return NextResponse.json({ canned_response: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
