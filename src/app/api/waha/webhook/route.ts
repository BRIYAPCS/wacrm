// ============================================================
// POST /api/waha/webhook — inbound events from our WAHA server.
//
// Each WAHA session is configured (at provisioning) to POST its events here.
// We resolve which account/number the event belongs to from the `session`
// field, then:
//   • message         → ingest inbound text into the inbox
//   • session.status  → keep the stored connection status/phone in sync
//
// Security: WAHA signs the raw body with HMAC-SHA512 and sends it in the
// `X-Webhook-Hmac` header (keyed by config.webhooks[].hmac.key, which we set
// from WAHA_WEBHOOK_HMAC_KEY). We verify it constant-time before trusting
// anything. If no key is configured we skip (test convenience).
// ============================================================

import { NextResponse, after } from "next/server";
import crypto from "node:crypto";

import { ingestInboundMessage, inboundMediaMarker } from "@/lib/whatsapp/ingest-inbound";
import { enrichContactFromWaha } from "@/lib/waha/profile";
import { chatIdToPhone, wahaBaseUrl, wahaWebhookHmacKey } from "@/lib/waha/config";
import { decrypt } from "@/lib/whatsapp/encryption";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function verifySignature(raw: string, header: string | null): boolean {
  const secret = wahaWebhookHmacKey();
  if (!secret) return true; // no key configured → skip (test convenience)
  if (!header) return false;
  const expected = crypto.createHmac("sha512", secret).update(raw).digest("hex");
  const a = Buffer.from(header.trim(), "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

interface MessagePayload {
  id?: string;
  timestamp?: number;
  from?: string;
  fromMe?: boolean;
  body?: string;
  hasMedia?: boolean;
  /** WAHA message type: chat|image|video|audio|ptt|document|sticker|location… */
  type?: string;
  /** message.ack: numeric level (-1 err, 1 server, 2 device, 3 read, 4 played). */
  ack?: number;
  ackName?: string;
  notifyName?: string;
  _data?: {
    notifyName?: string;
    pushName?: string;
    notify?: string;
    // GOWS raw message info — carries the real phone when WhatsApp addresses
    // the message by LID (privacy identifier) instead of the number.
    Info?: {
      SenderAlt?: string;
      ChatAlt?: string;
      Sender?: string;
      Chat?: string;
    };
  };
}

/**
 * The sender's real phone address. Newer WhatsApp addresses messages by a LID
 * (`<id>@lid`) rather than the phone; in that case the real number is carried
 * in `_data.Info.SenderAlt` (an `@s.whatsapp.net` jid). Fall back to `from`
 * when it's already a phone-style address (or when no alt is present).
 */
function resolveSenderAddress(p: MessagePayload): string {
  const from = p.from ?? "";
  if (!from.endsWith("@lid")) return from;
  const info = p._data?.Info ?? {};
  const alt = info.SenderAlt || info.ChatAlt || "";
  return typeof alt === "string" && alt.includes("@") ? alt : from;
}

// WAHA delivery ack → our message status (drives the ✓/✓✓/✓✓-blue ticks).
function wahaAckToStatus(level: number | null, name?: string): string | null {
  const n = (name ?? "").toUpperCase();
  if (level === -1 || n === "ERROR") return "failed";
  if ((level !== null && level >= 3) || n === "READ" || n === "PLAYED") return "read";
  if (level === 2 || n === "DEVICE" || n === "DELIVERED") return "delivered";
  if (level === 1 || n === "SERVER" || n === "SENT") return "sent";
  return null; // pending / unknown → ignore
}

// Forward-only guard (mirrors the Meta webhook): each status may only overwrite
// a valid predecessor, so out-of-order acks never regress a tick.
const MESSAGE_STATUS_PREDECESSORS: Record<string, string[]> = {
  sent: ["sending"],
  delivered: ["sending", "sent"],
  read: ["sending", "sent", "delivered"],
  failed: ["sending", "sent"],
};

export async function POST(request: Request) {
  const raw = await request.text();

  let body:
    | {
        event?: string;
        session?: string;
        payload?: MessagePayload & { status?: string; me?: { id?: string } };
        me?: { id?: string; pushName?: string } | null;
      }
    | null = null;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const session = body?.session ?? "";
  if (!session) {
    return NextResponse.json({ error: "Missing session" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: cfg } = await admin
    .from("whatsapp_config")
    .select("id, account_id, user_id, access_token, base_url, phone_number, status")
    .eq("provider", "waha")
    .eq("waha_session", session)
    .maybeSingle();
  if (!cfg) {
    // Not one of our sessions — ack so WAHA stops retrying.
    return NextResponse.json({ received: true, ignored: "unknown-session" });
  }

  if (!verifySignature(raw, request.headers.get("x-webhook-hmac"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Keep the stored connection status in sync as the session comes online.
  if (body?.event === "session.status") {
    const status = body.payload?.status;
    const connected = status === "WORKING";
    const meId = body.me?.id ?? body.payload?.me?.id ?? null;
    const phone = meId ? chatIdToPhone(meId) : cfg.phone_number;
    const nextStatus = connected ? "connected" : "disconnected";
    if (cfg.status !== nextStatus || (phone && phone !== cfg.phone_number)) {
      await admin
        .from("whatsapp_config")
        .update({
          status: nextStatus,
          phone_number: phone ?? cfg.phone_number,
          connected_at: connected ? new Date().toISOString() : null,
        })
        .eq("id", cfg.id);
    }
    return NextResponse.json({ received: true });
  }

  // Delivery/read receipt for an outbound message → advance its tick status.
  if (body?.event === "message.ack") {
    const p = body.payload ?? {};
    const ackId = typeof p.id === "string" ? p.id : "";
    const status = wahaAckToStatus(
      typeof p.ack === "number" ? p.ack : null,
      p.ackName,
    );
    const preds = status ? MESSAGE_STATUS_PREDECESSORS[status] : undefined;
    if (ackId && status && preds) {
      await admin
        .from("messages")
        .update({ status })
        .eq("message_id", ackId)
        .in("status", preds);
    }
    return NextResponse.json({ received: true });
  }

  if (body?.event !== "message" || !body.payload) {
    return NextResponse.json({ received: true, ignored: body?.event ?? "unknown" });
  }

  const p = body.payload;
  const from = p.from ?? "";
  const isGroup = from.endsWith("@g.us");
  const text = (p.body ?? "").trim();
  // Media (photo/voice/document/…) may arrive with an empty body — surface a
  // marker so it lands in the inbox instead of being silently dropped. A
  // caption, when present, is used as-is.
  const effectiveText = text || inboundMediaMarker(p.type, p.hasMedia) || "";

  // Ignore our own echoes, group chats, and truly-empty/no-sender events.
  if (p.fromMe || !from || isGroup || !effectiveText) {
    return NextResponse.json({ received: true, ignored: "not-an-inbound-message" });
  }

  try {
    // Resolve the real phone (handles WhatsApp LID addressing — see helper).
    const senderAddress = resolveSenderAddress(p);
    // Never fabricate a phone from an unresolved LID: if we couldn't map the
    // `@lid` to a real @s.whatsapp.net/@c.us number, dropping the digits would
    // create a bogus contact and send replies to a number that doesn't exist.
    // Ack and skip instead.
    if (senderAddress.endsWith("@lid")) {
      console.warn(`[waha webhook] unresolved LID ${from} — no SenderAlt; skipping`);
      return NextResponse.json({ received: true, ignored: "unresolved-lid" });
    }
    const phone = chatIdToPhone(senderAddress);
    if (from.endsWith("@lid")) {
      console.log(
        `[waha webhook] LID ${from} -> ${senderAddress} (${phone})`,
      );
    }
    const name =
      p.notifyName ?? p._data?.notifyName ?? p._data?.pushName ?? p._data?.notify ?? "";
    const result = await ingestInboundMessage({
      accountId: cfg.account_id,
      ownerUserId: cfg.user_id,
      configId: cfg.id,
      phone,
      name,
      text: effectiveText,
      messageId: p.id || `waha-${Date.now()}`,
      timestampSec:
        typeof p.timestamp === "number" ? p.timestamp : Math.floor(Date.now() / 1000),
    });

    // Enrich the contact's WhatsApp profile after responding — best-effort.
    if (result?.contactId) {
      const creds = {
        baseUrl: wahaBaseUrl(cfg.base_url),
        apiKey: decrypt(cfg.access_token),
        session,
      };
      after(() => enrichContactFromWaha(admin, creds, result.contactId, phone));
    }

    return NextResponse.json({
      received: true,
      conversationId: result?.conversationId ?? null,
    });
  } catch (err) {
    console.error("[waha webhook] ingest error:", err);
    return NextResponse.json({ received: true, error: "ingest_failed" });
  }
}
