// ============================================================
// Ingest an inbound WhatsApp message into the inbox — provider-agnostic.
//
// The provider webhook resolves WHICH account + number (whatsapp_config
// row) an event belongs to and passes it here. Mirrors the Meta webhook's
// contact/conversation/message flow, stamping the conversation with the
// config id so replies route back out through the same number/provider.
// Uses the service role.
// ============================================================

import { supabaseAdmin } from "@/lib/supabase/admin";
import { findExistingContact, isUniqueViolation } from "@/lib/contacts/dedupe";

/**
 * A human-readable marker for a non-text inbound message, so a media message
 * (image/voice/document/…) is surfaced in the thread instead of being dropped.
 * Returns null for a plain text message (use its body) or an unknown type with
 * no media. Full media download/preview is a follow-up; this guarantees the
 * agent at least SEES that the customer sent something.
 */
export function inboundMediaMarker(
  type: string | null | undefined,
  hasMedia?: boolean,
): string | null {
  switch ((type ?? "").toLowerCase()) {
    case "image":
      return "📷 Photo";
    case "video":
      return "🎥 Video";
    case "audio":
    case "ptt":
    case "voice":
      return "🎤 Voice message";
    case "document":
      return "📄 Document";
    case "sticker":
      return "🃏 Sticker";
    case "location":
      return "📍 Location";
    case "contact":
    case "vcard":
    case "contacts":
      return "👤 Contact card";
    default:
      return hasMedia ? "📎 Attachment" : null;
  }
}

export interface InboundMessage {
  accountId: string;
  ownerUserId: string;
  /** whatsapp_config.id of the number that received the message. */
  configId: string;
  /** Direct: the sender's phone ("+1240…"). Group: the group JID ("…@g.us"). */
  phone: string;
  /** Direct: the sender's name. Group: the group subject. */
  name: string;
  text: string;
  messageId: string;
  timestampSec: number;
  /** True when `phone` is a group JID — routes to a group conversation. */
  isGroup?: boolean;
  /** Group only: the participant who sent this message (phone + display name). */
  senderPhone?: string;
  senderName?: string;
}

/** Returns { conversationId, contactId, contactCreated } on success, or null. */
export async function ingestInboundMessage(
  msg: InboundMessage,
): Promise<{
  conversationId: string;
  contactId: string;
  contactCreated: boolean;
} | null> {
  const admin = supabaseAdmin();

  // --- contact ---
  let contactId: string;
  let contactCreated = false;

  if (msg.isGroup) {
    // A group is a contact keyed by its JID and flagged is_group. It bypasses
    // the phone-dedupe path entirely (a group JID is not a person's number).
    const { data: g } = await admin
      .from("contacts")
      .select("id, name")
      .eq("account_id", msg.accountId)
      .eq("phone", msg.phone)
      .eq("is_group", true)
      .maybeSingle();
    if (g) {
      contactId = g.id;
      if (msg.name && msg.name !== g.name) {
        await admin
          .from("contacts")
          .update({ name: msg.name, updated_at: new Date().toISOString() })
          .eq("id", g.id);
      }
    } else {
      const { data: created, error } = await admin
        .from("contacts")
        .insert({
          account_id: msg.accountId,
          user_id: msg.ownerUserId,
          phone: msg.phone,
          name: msg.name || "Group chat",
          is_group: true,
        })
        .select("id")
        .single();
      if (error || !created) {
        const { data: raced } = await admin
          .from("contacts")
          .select("id")
          .eq("account_id", msg.accountId)
          .eq("phone", msg.phone)
          .eq("is_group", true)
          .maybeSingle();
        if (!raced) {
          console.error("[inbound] group contact insert failed:", error);
          return null;
        }
        contactId = raced.id;
      } else {
        contactId = created.id;
        contactCreated = true;
      }
    }
  } else {
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
          console.error("[inbound] contact insert failed:", error);
          return null;
        }
      } else {
        contactId = created.id;
        contactCreated = true;
      }
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
        console.error("[inbound] conversation insert failed:", error);
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
    // Group only: attribute the bubble to the participant who sent it.
    sender_phone: msg.isGroup ? msg.senderPhone ?? null : null,
    sender_name: msg.isGroup ? msg.senderName ?? null : null,
    created_at: new Date(msg.timestampSec * 1000).toISOString(),
  });
  if (msgErr) {
    if (isUniqueViolation(msgErr))
      return { conversationId, contactId, contactCreated }; // dedupe
    console.error("[inbound] message insert failed:", msgErr);
    return null;
  }

  // In a group, prefix the list preview with who spoke ("Alice: hi") so the
  // conversation row is legible without opening it.
  const preview =
    msg.isGroup && msg.senderName
      ? `${msg.senderName}: ${msg.text || "[message]"}`
      : msg.text || "[message]";
  await admin.rpc("bump_conversation_on_inbound", {
    p_conversation_id: conversationId,
    p_last_text: preview,
    p_last_at: new Date(msg.timestampSec * 1000).toISOString(),
  });

  return { conversationId, contactId, contactCreated };
}
