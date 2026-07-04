// ============================================================
// /api/canned-responses/[id]
//   PATCH  — update a saved reply.  Agent+.
//   DELETE — remove a saved reply.  Agent+.
//
// RLS scopes both to the caller's account; a wrong id simply matches
// no row (404), never another account's.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { parseCannedBody } from "../route";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const limit = checkRateLimit(`cannedWrite:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await context.params;
    const parsed = parseCannedBody(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const { data, error } = await ctx.supabase
      .from("canned_responses")
      .update({
        shortcut: parsed.shortcut,
        title: parsed.title,
        content: parsed.content,
      })
      .eq("id", id)
      .select("id, shortcut, title, content, created_by, updated_at")
      .maybeSingle();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: `A saved reply with the shortcut "/${parsed.shortcut}" already exists.` },
          { status: 409 },
        );
      }
      console.error("[PATCH /api/canned-responses/[id]]", error);
      return NextResponse.json({ error: "Failed to update saved reply" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ canned_response: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await context.params;

    const { data, error } = await ctx.supabase
      .from("canned_responses")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[DELETE /api/canned-responses/[id]]", error);
      return NextResponse.json({ error: "Failed to delete saved reply" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
