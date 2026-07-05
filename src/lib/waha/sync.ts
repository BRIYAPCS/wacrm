// ============================================================
// WAHA history sync — import the connected number's existing chats + message
// history into the inbox (contacts, conversations, messages). Runs with the
// service role. `fromMe` messages (sent from the phone directly) are imported
// as OUTBOUND (agent) so the inbox mirrors the phone.
//
// Dedup: by the trailing WhatsApp message key, so re-running the sync and the
// live webhook never double-insert the same message (app-sent messages store a
// different id form than the phone echo, but share the trailing key).
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { chatIdToPhone, type WahaCreds } from "./config";
import {
  wahaListChats,
  wahaFetchMessages,
  type WahaHistoryMessage,
  type WahaChatOverview,
} from "./client";
import { inboundMediaMarker } from "@/lib/whatsapp/ingest-inbound";
import { findExistingContact, isUniqueViolation } from "@/lib/contacts/dedupe";

/** "Everything" scope, capped per chat as a runaway safety net. */
const PER_CHAT_MESSAGE_LIMIT = 10_000;
const INSERT_CHUNK = 500;

export interface SyncConfig {
  accountId: string;
  ownerUserId: string;
  configId: string;
}

export interface SyncResult {
  chats: number;
  imported: number;
  skipped: number;
}

function ackToStatus(ack?: number): "sent" | "delivered" | "read" {
  if (typeof ack !== "number") return "sent";
  if (ack >= 3) return "read";
  if (ack === 2) return "delivered";
  return "sent";
}

/** The stable trailing WhatsApp message key (matches the webhook + ack path). */
function keyOf(m: WahaHistoryMessage): string {
  return (
    m._data?.Info?.ID ||
    (typeof m.id === "string" ? (m.id.split("_").pop() ?? m.id) : "") ||
    ""
  );
}

function messageText(m: WahaHistoryMessage): string {
  const body = (m.body ?? "").trim();
  if (body) return body;
  const type = m.type ?? m._data?.Info?.MediaType ?? m._data?.Info?.Type;
  return inboundMediaMarker(type, m.hasMedia) ?? "";
}

/** Resolve a 1:1 chat's phone. Groups handled separately; unresolvable LID
 *  chats are skipped (we can't fabricate a real number). */
function chatPhone(chat: WahaChatOverview): string | null {
  const id = chat.id;
  if (id.endsWith("@c.us") || id.endsWith("@s.whatsapp.net")) {
    return chatIdToPhone(id);
  }
  if (id.endsWith("@lid")) {
    const info = chat.lastMessage?._data?.Info;
    const alt = info?.RecipientAlt || info?.SenderAlt || "";
    if (alt.endsWith("@c.us") || alt.endsWith("@s.whatsapp.net")) {
      return chatIdToPhone(alt);
    }
    return null;
  }
  return null;
}

async function upsertIndividualContact(
  admin: SupabaseClient,
  cfg: SyncConfig,
  phone: string,
  name?: string | null,
): Promise<string> {
  const existing = await findExistingContact(admin, cfg.accountId, phone);
  if (existing) {
    if (name && name !== existing.name) {
      await admin.from("contacts").update({ name }).eq("id", existing.id);
    }
    return existing.id;
  }
  const { data } = await admin
    .from("contacts")
    .insert({
      account_id: cfg.accountId,
      user_id: cfg.ownerUserId,
      phone,
      name: name || phone,
    })
    .select("id")
    .single();
  if (data) return data.id as string;
  const raced = await findExistingContact(admin, cfg.accountId, phone);
  if (raced) return raced.id;
  throw new Error(`contact upsert failed for ${phone}`);
}

async function upsertGroupContact(
  admin: SupabaseClient,
  cfg: SyncConfig,
  jid: string,
  name?: string | null,
): Promise<string> {
  const { data: g } = await admin
    .from("contacts")
    .select("id")
    .eq("account_id", cfg.accountId)
    .eq("phone", jid)
    .eq("is_group", true)
    .maybeSingle();
  if (g) return g.id as string;
  const { data } = await admin
    .from("contacts")
    .insert({
      account_id: cfg.accountId,
      user_id: cfg.ownerUserId,
      phone: jid,
      name: name || "Group chat",
      is_group: true,
    })
    .select("id")
    .single();
  if (data) return data.id as string;
  const { data: raced } = await admin
    .from("contacts")
    .select("id")
    .eq("account_id", cfg.accountId)
    .eq("phone", jid)
    .eq("is_group", true)
    .maybeSingle();
  if (raced) return raced.id as string;
  throw new Error(`group upsert failed for ${jid}`);
}

async function upsertConversation(
  admin: SupabaseClient,
  cfg: SyncConfig,
  contactId: string,
): Promise<string> {
  const { data: c } = await admin
    .from("conversations")
    .select("id, whatsapp_config_id")
    .eq("account_id", cfg.accountId)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (c) {
    if (c.whatsapp_config_id !== cfg.configId) {
      await admin
        .from("conversations")
        .update({ whatsapp_config_id: cfg.configId })
        .eq("id", c.id);
    }
    return c.id as string;
  }
  const { data } = await admin
    .from("conversations")
    .insert({
      account_id: cfg.accountId,
      user_id: cfg.ownerUserId,
      contact_id: contactId,
      whatsapp_config_id: cfg.configId,
    })
    .select("id")
    .single();
  if (data) return data.id as string;
  const { data: raced } = await admin
    .from("conversations")
    .select("id")
    .eq("account_id", cfg.accountId)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (raced) return raced.id as string;
  throw new Error("conversation upsert failed");
}

async function importChat(
  admin: SupabaseClient,
  cfg: SyncConfig,
  creds: WahaCreds,
  chat: WahaChatOverview,
): Promise<{ imported: number }> {
  const chatId = chat.id;
  // Skip status/broadcast/channel pseudo-chats (not 1:1 conversations).
  if (
    chatId.endsWith("@broadcast") ||
    chatId.endsWith("@newsletter") ||
    chatId === "status@broadcast"
  ) {
    return { imported: 0 };
  }

  const isGroup = chatId.endsWith("@g.us");
  let contactId: string;
  if (isGroup) {
    contactId = await upsertGroupContact(admin, cfg, chatId, chat.name);
  } else {
    const phone = chatPhone(chat);
    if (!phone) return { imported: 0 }; // unresolvable LID chat
    contactId = await upsertIndividualContact(admin, cfg, phone, chat.name);
  }

  const conversationId = await upsertConversation(admin, cfg, contactId);

  // Trailing keys already present in this conversation (dedup with prior syncs
  // and the live webhook).
  const { data: existing } = await admin
    .from("messages")
    .select("message_id")
    .eq("conversation_id", conversationId);
  const seen = new Set<string>();
  for (const r of existing ?? []) {
    const mid = (r as { message_id: string | null }).message_id;
    if (mid) {
      seen.add(mid);
      const k = mid.split("_").pop();
      if (k) seen.add(k);
    }
  }

  const msgs = await wahaFetchMessages(creds, chatId, PER_CHAT_MESSAGE_LIMIT);

  const rows: Record<string, unknown>[] = [];
  for (const m of msgs) {
    const key = keyOf(m);
    if (!key || seen.has(key) || (m.id && seen.has(m.id))) continue;
    const text = messageText(m);
    if (!text) continue;
    const fromMe = !!m.fromMe;
    const row: Record<string, unknown> = {
      conversation_id: conversationId,
      sender_type: fromMe ? "agent" : "customer",
      content_type: "text",
      content_text: text,
      message_id: m.id ?? key,
      status: fromMe ? ackToStatus(m.ack) : "delivered",
      created_at: new Date(
        (m.timestamp ?? Math.floor(Date.now() / 1000)) * 1000,
      ).toISOString(),
    };
    if (isGroup && !fromMe) {
      const senderJid =
        m._data?.Info?.SenderAlt || m._data?.Info?.Sender || m.from || "";
      row.sender_phone = senderJid ? chatIdToPhone(senderJid) : null;
      row.sender_name =
        m._data?.Info?.PushName ||
        m.notifyName ||
        m._data?.pushName ||
        null;
    }
    rows.push(row);
    seen.add(key);
  }

  let imported = 0;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    const { error } = await admin.from("messages").insert(chunk);
    if (error) {
      // A rare key collision fails the whole chunk — retry per-row so the
      // rest still land.
      for (const r of chunk) {
        const { error: e2 } = await admin.from("messages").insert(r);
        if (!e2) imported += 1;
        else if (!isUniqueViolation(e2)) {
          console.error("[waha sync] message insert:", e2.message);
        }
      }
    } else {
      imported += chunk.length;
    }
  }

  // Surface the newest message on the conversation row (list preview/order).
  const newest = msgs[0];
  if (newest) {
    await admin
      .from("conversations")
      .update({
        last_message_text: messageText(newest) || "[message]",
        last_message_at: new Date(
          (newest.timestamp ?? Math.floor(Date.now() / 1000)) * 1000,
        ).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId);
  }

  return { imported };
}

/**
 * Import every chat + full history for the connected number. Best-effort per
 * chat — a single failing chat is logged and skipped, not fatal. Inserts flow
 * into the DB so the inbox's realtime subscription fills in live.
 */
export async function syncWahaHistory(
  admin: SupabaseClient,
  cfg: SyncConfig,
  creds: WahaCreds,
): Promise<SyncResult> {
  const chats = await wahaListChats(creds, 1000);
  let imported = 0;
  let skipped = 0;
  for (const chat of chats) {
    try {
      const r = await importChat(admin, cfg, creds, chat);
      imported += r.imported;
    } catch (err) {
      skipped += 1;
      console.error(`[waha sync] chat ${chat.id} failed:`, err);
    }
  }
  console.log(
    `[waha sync] done: ${chats.length} chats, ${imported} messages imported, ${skipped} skipped`,
  );
  return { chats: chats.length, imported, skipped };
}
