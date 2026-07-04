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

export async function GET(request: Request) {
  const denied = verifyCronSecret(request);
  if (denied) return denied;

  const admin = supabaseAdmin();

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
  if (!due || due.length === 0) return NextResponse.json({ sent: 0, failed: 0 });

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

  return NextResponse.json({ sent, failed });
}
