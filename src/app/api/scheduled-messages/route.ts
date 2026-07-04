// ============================================================
// /api/scheduled-messages
//   GET  ?conversationId=… — upcoming (pending) sends for a thread.
//                            Any member.
//   POST — schedule a text message for later.  Agent+.
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

const BODY_MAX = 4096;
// Guard against fat-finger "schedule for 5 years" — a year is plenty.
const MAX_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;
// Small negative tolerance so "now-ish" clicks don't 400 on clock skew.
const MIN_LEAD_MS = -60 * 1000;

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const conversationId = new URL(request.url).searchParams.get("conversationId");
    if (!conversationId) {
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    }
    const { data, error } = await ctx.supabase
      .from("scheduled_messages")
      .select("id, body, send_at, status, created_by, created_at")
      .eq("conversation_id", conversationId)
      .eq("status", "pending")
      .order("send_at", { ascending: true });
    if (error) {
      console.error("[GET /api/scheduled-messages]", error);
      return NextResponse.json({ error: "Failed to load scheduled messages" }, { status: 500 });
    }
    return NextResponse.json({ scheduled_messages: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const limit = checkRateLimit(`schedule:${ctx.userId}`, RATE_LIMITS.send);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { conversationId?: unknown; body?: unknown; sendAt?: unknown }
      | null;
    const conversationId = typeof body?.conversationId === "string" ? body.conversationId : "";
    const text = typeof body?.body === "string" ? body.body : "";
    const sendAtRaw = typeof body?.sendAt === "string" ? body.sendAt : "";

    if (!conversationId) return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    if (!text.trim()) return NextResponse.json({ error: "Message body is required" }, { status: 400 });
    if (text.length > BODY_MAX)
      return NextResponse.json({ error: `Message must be ${BODY_MAX} characters or fewer` }, { status: 400 });

    const sendAt = new Date(sendAtRaw);
    if (Number.isNaN(sendAt.getTime()))
      return NextResponse.json({ error: "A valid send time is required" }, { status: 400 });
    const lead = sendAt.getTime() - Date.now();
    if (lead < MIN_LEAD_MS)
      return NextResponse.json({ error: "The send time must be in the future" }, { status: 400 });
    if (lead > MAX_AHEAD_MS)
      return NextResponse.json({ error: "The send time can be at most a year out" }, { status: 400 });

    // Resolve + verify the conversation belongs to the caller's account
    // (RLS also enforces this), and grab its contact_id for the row.
    const { data: conv, error: convErr } = await ctx.supabase
      .from("conversations")
      .select("id, contact_id")
      .eq("id", conversationId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (convErr || !conv) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const { data, error } = await ctx.supabase
      .from("scheduled_messages")
      .insert({
        account_id: ctx.accountId,
        conversation_id: conversationId,
        contact_id: (conv as { contact_id: string }).contact_id,
        created_by: ctx.userId,
        body: text,
        send_at: sendAt.toISOString(),
      })
      .select("id, body, send_at, status, created_by, created_at")
      .single();

    if (error) {
      console.error("[POST /api/scheduled-messages]", error);
      return NextResponse.json({ error: "Failed to schedule message" }, { status: 500 });
    }
    return NextResponse.json({ scheduled_message: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
