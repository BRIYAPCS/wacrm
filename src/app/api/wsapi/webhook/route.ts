// ============================================================
// POST /api/wsapi/webhook — inbound events from WSAPI (wsapi.chat).
//
// Point your WSAPI instance's webhook URL at this route. On a `message`
// event that isn't from us, we ingest it into the wacrm inbox. Inert
// unless WSAPI is enabled.
//
// Security: if WSAPI_WEBHOOK_SECRET is set, we verify the
// `X-Webhook-Signature: sha256=<hex HMAC-SHA256 of the raw body>` header
// before trusting anything (constant-time compare).
// ============================================================

import { NextResponse, after } from "next/server";
import crypto from "node:crypto";

import { jidToPhone } from "@/lib/wsapi/config";
import { ingestInboundMessage } from "@/lib/whatsapp/ingest-inbound";
import { enrichContactFromWsapi } from "@/lib/wsapi/profile";
import { decrypt } from "@/lib/whatsapp/encryption";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function verifySignature(raw: string, header: string | null): boolean {
  const secret = process.env.WSAPI_WEBHOOK_SECRET;
  if (!secret) return true; // no secret configured → skip (test convenience)
  if (!header) return false;
  const provided = header.startsWith("sha256=") ? header.slice(7) : header;
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Pull the fields we need out of a WSAPI message event, defensively.
// Real WSAPI shape (confirmed from live traffic):
//   { id, chatId, sender:{id,phone,isMe}, isGroup, time(ISO), type, text }
// Baileys-ish shape is also handled as a fallback.
function extract(d: Record<string, unknown>) {
  const key = (d.key ?? {}) as Record<string, unknown>;
  const sender = (d.sender ?? {}) as Record<string, unknown>;
  const message = (d.message ?? {}) as Record<string, unknown>;

  const remoteJid =
    (d.chatId as string) ??
    (key.remoteJid as string) ??
    (sender.id as string) ??
    (d.remoteJid as string) ??
    (d.from as string) ??
    "";
  const fromMe = Boolean(sender.isMe ?? key.fromMe ?? d.fromMe ?? false);
  const isGroup = Boolean(d.isGroup) || String(remoteJid).endsWith("@g.us");
  const id = (d.id as string) ?? (key.id as string) ?? "";
  const pushName =
    (d.pushName as string) ??
    (sender.pushName as string) ??
    (d.notifyName as string) ??
    "";

  const ext = message.extendedTextMessage as { text?: string } | undefined;
  const img = message.imageMessage as { caption?: string } | undefined;
  const text =
    (d.text as string) ??
    (message.conversation as string) ??
    ext?.text ??
    img?.caption ??
    (d.body as string) ??
    "";

  // `time` is an ISO string on the real shape; `messageTimestamp` is unix
  // seconds on the Baileys shape.
  let timestampSec: number;
  if (typeof d.time === "string") {
    const ms = Date.parse(d.time);
    timestampSec = Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000);
  } else {
    const tsRaw = d.messageTimestamp ?? d.timestamp;
    timestampSec =
      typeof tsRaw === "number"
        ? tsRaw
        : typeof tsRaw === "string" && tsRaw
          ? parseInt(tsRaw, 10)
          : Math.floor(Date.now() / 1000);
  }

  return { remoteJid, fromMe, id, isGroup, pushName, text, timestampSec };
}

export async function POST(request: Request) {
  // Resolve which account + number this event belongs to from the instance
  // id WSAPI sends in the X-Instance-Id header (falls back to the body's
  // instanceId). Unknown instance → not one of our connected numbers.
  const raw = await request.text();

  let bodyInstanceId: string | undefined;
  try {
    bodyInstanceId = (JSON.parse(raw) as { instanceId?: string }).instanceId;
  } catch {
    /* handled below */
  }
  const instanceId =
    request.headers.get("x-instance-id") ?? bodyInstanceId ?? "";
  if (!instanceId) {
    return NextResponse.json({ error: "Missing instance id" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: cfg } = await admin
    .from("whatsapp_config")
    .select("id, account_id, user_id, access_token")
    .eq("provider", "wsapi")
    .eq("wsapi_instance_id", instanceId)
    .maybeSingle();
  if (!cfg) {
    // Not a number connected to this app — ack so WSAPI stops retrying.
    return NextResponse.json({ received: true, ignored: "unknown-instance" });
  }

  if (!verifySignature(raw, request.headers.get("x-webhook-signature"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: { eventType?: string; eventData?: Record<string, unknown> } | null = null;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Log the raw event during testing so the exact shape is visible in the
  // server console (helps confirm/adjust the parser on the first message).
  console.log("[wsapi webhook] event:", body?.eventType, JSON.stringify(body?.eventData));

  if (body?.eventType !== "message" || !body.eventData) {
    return NextResponse.json({ received: true, ignored: body?.eventType ?? "unknown" });
  }

  const m = extract(body.eventData);

  // Ignore our own outbound echoes, group messages, and empty/no-JID events.
  if (m.fromMe || !m.remoteJid || m.isGroup || !m.text.trim()) {
    return NextResponse.json({ received: true, ignored: "not-an-inbound-text" });
  }

  try {
    const phone = jidToPhone(m.remoteJid);
    const result = await ingestInboundMessage({
      accountId: cfg.account_id,
      ownerUserId: cfg.user_id,
      configId: cfg.id,
      phone,
      name: m.pushName,
      text: m.text,
      messageId: m.id || `wsapi-${Date.now()}`,
      timestampSec: m.timestampSec,
    });

    // Enrich the contact's WhatsApp profile (photo + about) after we've
    // responded — best-effort, staleness-guarded, using this number's creds.
    if (result?.contactId) {
      const creds = { instanceId, apiKey: decrypt(cfg.access_token) };
      after(() => enrichContactFromWsapi(admin, creds, result.contactId, phone));
    }

    return NextResponse.json({ received: true, conversationId: result?.conversationId ?? null });
  } catch (err) {
    console.error("[wsapi webhook] ingest error:", err);
    // 200 anyway so WSAPI doesn't hammer retries during testing.
    return NextResponse.json({ received: true, error: "ingest_failed" });
  }
}
