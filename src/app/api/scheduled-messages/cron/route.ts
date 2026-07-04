// ============================================================
// GET /api/scheduled-messages/cron — send due scheduled messages.
//
// Driven by the same scheduler as automation Wait steps and flow
// timeouts (docs/automations-and-cron.md). Claims each due row with a
// `pending → sending` UPDATE so two overlapping ticks can't double-send,
// then delegates to the shared send core and marks the row sent/failed.
// ============================================================

import { NextResponse } from "next/server";

import { verifyCronSecret } from "@/lib/cron/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  sendMessageToConversation,
  SendMessageError,
} from "@/lib/whatsapp/send-message";

interface DueRow {
  id: string;
  account_id: string;
  conversation_id: string;
  body: string;
}

// How long a row may sit in `sending` before the reaper treats it as
// abandoned. Comfortably longer than a single tick's send work, so a
// legitimately in-flight row is never reaped out from under a live worker.
const STALE_SENDING_MS = 10 * 60 * 1000; // 10 minutes

export async function GET(request: Request) {
  const denied = verifyCronSecret(request);
  if (denied) return denied;

  const admin = supabaseAdmin();

  // Reaper: reclaim rows stuck in `sending`. If a worker died between
  // claiming a row (pending → sending) and writing the terminal status, it
  // would otherwise stay `sending` forever — never retried (the drain below
  // only reads `pending`) and never surfaced. We mark such rows `failed`
  // rather than re-queue them: the send may have already reached Meta
  // before the crash, so retrying would risk double-texting the customer.
  // The `updated_at` trigger stamps the claim time, so "stuck" = last
  // touched more than STALE_SENDING_MS ago.
  const staleBefore = new Date(Date.now() - STALE_SENDING_MS).toISOString();
  const { data: reaped, error: reapErr } = await admin
    .from("scheduled_messages")
    .update({
      status: "failed",
      error:
        "Send was interrupted (worker timed out) and not retried automatically to avoid a duplicate. Reschedule if the message didn't arrive.",
    })
    .eq("status", "sending")
    .lt("updated_at", staleBefore)
    .select("id");
  const reapedCount = reaped?.length ?? 0;
  if (reapErr) {
    console.error("[scheduled-cron] reaper failed:", reapErr.message);
  } else if (reapedCount > 0) {
    console.warn(`[scheduled-cron] reaped ${reapedCount} stuck 'sending' row(s)`);
  }

  const { data: due, error } = await admin
    .from("scheduled_messages")
    .select("id, account_id, conversation_id, body")
    .eq("status", "pending")
    .lte("send_at", new Date().toISOString())
    .order("send_at", { ascending: true })
    .limit(50);

  if (error) {
    console.error("[scheduled-cron] scan failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!due || due.length === 0)
    return NextResponse.json({ sent: 0, failed: 0, reaped: reapedCount });

  let sent = 0;
  let failed = 0;

  for (const row of due as DueRow[]) {
    // Claim it — only one worker wins the pending → sending transition.
    const { data: claimed } = await admin
      .from("scheduled_messages")
      .update({ status: "sending" })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    try {
      const result = await sendMessageToConversation(admin, row.account_id, {
        conversationId: row.conversation_id,
        messageType: "text",
        contentText: row.body,
      });
      await admin
        .from("scheduled_messages")
        .update({ status: "sent", sent_message_id: result.messageId, error: null })
        .eq("id", row.id);
      sent += 1;
    } catch (err) {
      const message =
        err instanceof SendMessageError
          ? err.message
          : err instanceof Error
            ? err.message
            : "send failed";
      console.error(`[scheduled-cron] send failed for ${row.id}:`, message);
      await admin
        .from("scheduled_messages")
        .update({ status: "failed", error: message })
        .eq("id", row.id);
      failed += 1;
    }
  }

  return NextResponse.json({ sent, failed, reaped: reapedCount });
}
