// ============================================================
// DELETE /api/scheduled-messages/[id] — cancel a pending send. Agent+.
//
// Only a still-pending row can be canceled; one that's already sending
// or sent returns 409 (the cron may be mid-flight). RLS scopes the
// delete to the caller's account.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await context.params;

    const { data, error } = await ctx.supabase
      .from("scheduled_messages")
      .delete()
      .eq("id", id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[DELETE /api/scheduled-messages/[id]]", error);
      return NextResponse.json({ error: "Failed to cancel" }, { status: 500 });
    }
    if (!data) {
      // Either it doesn't exist / isn't ours, or it's no longer pending.
      return NextResponse.json(
        { error: "This message can no longer be canceled." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
