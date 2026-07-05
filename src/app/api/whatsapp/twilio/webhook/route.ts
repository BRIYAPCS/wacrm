// ============================================================
// POST /api/whatsapp/twilio/webhook — inbound Twilio WhatsApp messages.
//
// Twilio POSTs application/x-www-form-urlencoded. We resolve the account +
// number by the receiving sender (the `To` field → our whatsapp_config
// row), verify the `X-Twilio-Signature` (HMAC-SHA1 of the full URL + sorted
// params, keyed by the number's Auth Token), then ingest.
//
// Set this URL as the number's "A message comes in" webhook in Twilio.
// ============================================================

import { NextResponse } from "next/server";
import crypto from "node:crypto";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/whatsapp/encryption";
import { ingestInboundMessage } from "@/lib/whatsapp/ingest-inbound";

export const runtime = "nodejs";

/** `whatsapp:+1415…` / `+1415…` → `+1415…` */
function normalizeWa(v: string): string {
  const s = v.replace(/^whatsapp:/i, "").trim();
  const digits = s.replace(/[^\d]/g, "");
  return digits ? `+${digits}` : s;
}

/** Twilio request signature validation. */
function validTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string | null,
): boolean {
  if (!signature) return false;
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  const expected = crypto.createHmac("sha1", authToken).update(data, "utf8").digest("base64");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const raw = await request.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v;

  const to = params.To ? normalizeWa(params.To) : "";
  if (!to) return NextResponse.json({ error: "Missing To" }, { status: 400 });

  // Resolve which number received it.
  const admin = supabaseAdmin();
  const { data: cfg } = await admin
    .from("whatsapp_config")
    .select("id, account_id, user_id, access_token, phone_number")
    .eq("provider", "twilio")
    .eq("phone_number", to)
    .maybeSingle();
  if (!cfg) {
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { headers: { "Content-Type": "text/xml" } },
    );
  }

  // Verify the signature against the full public URL Twilio called.
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const { pathname, search } = new URL(request.url);
  const publicUrl = `${proto}://${host}${pathname}${search}`;
  const authToken = decrypt(cfg.access_token);
  if (!validTwilioSignature(authToken, publicUrl, params, request.headers.get("x-twilio-signature"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const from = params.From ? normalizeWa(params.From) : "";
  const text = params.Body ?? "";
  if (!from || !text.trim()) {
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { headers: { "Content-Type": "text/xml" } },
    );
  }

  try {
    await ingestInboundMessage({
      accountId: cfg.account_id,
      ownerUserId: cfg.user_id,
      configId: cfg.id,
      phone: from,
      name: params.ProfileName ?? "",
      text,
      messageId: params.MessageSid || `twilio-${Date.now()}`,
      timestampSec: Math.floor(Date.now() / 1000),
    });
  } catch (err) {
    console.error("[twilio webhook] ingest error:", err);
  }

  // Twilio expects TwiML; empty response = "no auto-reply".
  return new NextResponse(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    { headers: { "Content-Type": "text/xml" } },
  );
}
