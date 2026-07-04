// ============================================================
// /api/conversations/[id]/notes — internal (team-only) notes.
//   GET  — list this conversation's notes.        Any member.
//   POST — add a note (optionally @mentioning).   Agent+.
//
// Author names / avatars are resolved client-side from the member list
// the thread already holds, so the payload stays lean.
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

const BODY_MAX = 4000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await context.params;
    const { data, error } = await ctx.supabase
      .from("conversation_notes")
      .select("id, body, author_user_id, mentioned_user_ids, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("[GET notes]", error);
      return NextResponse.json({ error: "Failed to load notes" }, { status: 500 });
    }
    return NextResponse.json({ notes: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const limit = checkRateLimit(`note:${ctx.userId}`, RATE_LIMITS.send);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as
      | { body?: unknown; mentioned_user_ids?: unknown }
      | null;
    const text = typeof body?.body === "string" ? body.body : "";
    if (!text.trim()) return NextResponse.json({ error: "Note body is required" }, { status: 400 });
    if (text.length > BODY_MAX)
      return NextResponse.json({ error: `Note must be ${BODY_MAX} characters or fewer` }, { status: 400 });

    const mentioned = Array.isArray(body?.mentioned_user_ids)
      ? (body!.mentioned_user_ids as unknown[]).filter(
          (v): v is string => typeof v === "string" && UUID_RE.test(v),
        )
      : [];

    // Verify the conversation belongs to the caller's account (RLS also
    // enforces this on the note insert, but this returns a clean 404).
    const { data: conv } = await ctx.supabase
      .from("conversations")
      .select("id")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!conv) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

    const { data, error } = await ctx.supabase
      .from("conversation_notes")
      .insert({
        account_id: ctx.accountId,
        conversation_id: id,
        author_user_id: ctx.userId,
        body: text,
        mentioned_user_ids: Array.from(new Set(mentioned)),
      })
      .select("id, body, author_user_id, mentioned_user_ids, created_at")
      .single();

    if (error) {
      console.error("[POST notes]", error);
      return NextResponse.json({ error: "Failed to add note" }, { status: 500 });
    }
    return NextResponse.json({ note: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
