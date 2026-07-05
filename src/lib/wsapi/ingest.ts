// ============================================================
// Ingest an inbound wsapi.chat message into the wacrm inbox.
//
// The webhook resolves WHICH account + number (whatsapp_config row) an
// event belongs to from the X-Instance-Id header, and passes it here.
// Mirrors the Meta webhook's contact/conversation/message flow, stamping
// the conversation with the wsapi config id so replies route back out via
// WSAPI. Uses the service role.
// ============================================================

import { supabaseAdmin } from "@/lib/supabase/admin";
import { findExistingContact, isUniqueViolation } from "@/lib/contacts/dedupe";

export interface InboundWsapi {
  accountId: string;
  ownerUserId: string;
  /** whatsapp_config.id of the wsapi number that received the message. */
  configId: string;
  phone: string; // "+1240..."
  name: string;
  text: string;
  messageId: string;
  timestampSec: number;
}

/** Returns { conversationId } on success, or null if it couldn't ingest. */
export async function ingestInboundWsapi(
  msg: InboundWsapi,
): Promise<{ conversationId: string } | null> {
  const admin = supabaseAdmin();

  // --- contact ---
  let contactId: string;
  const existing = await findExistingContact(admin, msg.accountId, msg.phone);
  if (existing) {
    contactId = existing.id;
    if (msg.name && msg.name !== existing.name) {
      await admin
        .from("contacts")
        .update({ name: msg.name, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    }
  } else {
    const { data: created, error } = await admin
      .from("contacts")
      .insert({
        account_id: msg.accountId,
        user_id: msg.ownerUserId,
        phone: msg.phone,
        name: msg.name || msg.phone,
      })
      .select("id")
      .single();
    if (error || !created) {
      if (isUniqueViolation(error)) {
        const raced = await findExistingContact(admin, msg.accountId, msg.phone);
        if (!raced) return null;
        contactId = raced.id;
      } else {
        console.error("[wsapi] contact insert failed:", error);
        return null;
      }
    } else {
      contactId = created.id;
    }
  }

  // --- conversation (one open thread per contact) ---
  let conversationId: string;
  const { data: conv } = await admin
    .from("conversations")
    .select("id, whatsapp_config_id")
    .eq("account_id", msg.accountId)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (conv) {
    conversationId = conv.id;
    // Re-point the thread at the number that just received a message.
    if (conv.whatsapp_config_id !== msg.configId) {
      await admin
        .from("conversations")
        .update({ whatsapp_config_id: msg.configId })
        .eq("id", conv.id);
    }
  } else {
    const { data: newConv, error } = await admin
      .from("conversations")
      .insert({
        account_id: msg.accountId,
        user_id: msg.ownerUserId,
        contact_id: contactId,
        whatsapp_config_id: msg.configId,
      })
      .select("id")
      .single();
    if (error || !newConv) {
      const { data: raced } = await admin
        .from("conversations")
        .select("id")
        .eq("account_id", msg.accountId)
        .eq("contact_id", contactId)
        .maybeSingle();
      if (!raced) {
        console.error("[wsapi] conversation insert failed:", error);
        return null;
      }
      conversationId = raced.id;
    } else {
      conversationId = newConv.id;
    }
  }

  // --- message ---
  const { error: msgErr } = await admin.from("messages").insert({
    conversation_id: conversationId,
    sender_type: "customer",
    content_type: "text",
    content_text: msg.text,
    message_id: msg.messageId,
    status: "delivered",
    created_at: new Date(msg.timestampSec * 1000).toISOString(),
  });
  if (msgErr) {
    if (isUniqueViolation(msgErr)) return { conversationId }; // dedupe
    console.error("[wsapi] message insert failed:", msgErr);
    return null;
  }

  await admin.rpc("bump_conversation_on_inbound", {
    p_conversation_id: conversationId,
    p_last_text: msg.text || "[message]",
    p_last_at: new Date(msg.timestampSec * 1000).toISOString(),
  });

  return { conversationId };
}
