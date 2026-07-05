// ============================================================
// POST /api/whatsapp/wsapi/connect  (admin+)
//
// Connect an existing wsapi.chat instance as a WhatsApp number. Verifies
// the credentials against WSAPI, enforces the plan's `whatsapp_numbers`
// limit (Meta + wsapi combined), and stores it as a whatsapp_config row
// (provider='wsapi', api key encrypted). The number may still need the QR
// scanned — the UI polls /qr + /status next.
//
// Body: { instanceId, apiKey, label? }
// ============================================================

import { NextResponse } from "next/server";

import {
  requireRole,
  requireWithinLimit,
  toErrorResponse,
} from "@/lib/auth/account";
import { encrypt } from "@/lib/whatsapp/encryption";
import { jidToPhone } from "@/lib/wsapi/config";
import { wsapiSessionStatus } from "@/lib/wsapi/management";
import { WsapiError } from "@/lib/wsapi/client";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`wa-wsapi-connect:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { instanceId?: unknown; apiKey?: unknown; label?: unknown }
      | null;
    const instanceId = typeof body?.instanceId === "string" ? body.instanceId.trim() : "";
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
    const label =
      typeof body?.label === "string" && body.label.trim() ? body.label.trim().slice(0, 60) : "WhatsApp (wsapi.chat)";
    if (!instanceId || !apiKey) {
      return NextResponse.json(
        { error: "instanceId and apiKey are required" },
        { status: 400 },
      );
    }

    // Plan gate: count ALL of the account's numbers (both providers).
    const { count: current } = await ctx.supabase
      .from("whatsapp_config")
      .select("id", { count: "exact", head: true })
      .eq("account_id", ctx.accountId);
    requireWithinLimit(ctx, "whatsapp_numbers", current ?? 0, "WhatsApp numbers");

    // Verify the credentials + read the current session.
    let status;
    try {
      status = await wsapiSessionStatus({ instanceId, apiKey });
    } catch (err) {
      if (err instanceof WsapiError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }

    const phone = status.deviceId ? jidToPhone(status.deviceId) : null;

    // First number in the account becomes the default.
    const { count: existing } = await ctx.supabase
      .from("whatsapp_config")
      .select("id", { count: "exact", head: true })
      .eq("account_id", ctx.accountId);

    const { data: row, error } = await ctx.supabase
      .from("whatsapp_config")
      .insert({
        account_id: ctx.accountId,
        user_id: ctx.userId,
        provider: "wsapi",
        wsapi_instance_id: instanceId,
        access_token: encrypt(apiKey),
        phone_number: phone,
        label,
        status: status.isConnected && status.isLoggedIn ? "connected" : "disconnected",
        connected_at: status.isConnected ? new Date().toISOString() : null,
        is_default: (existing ?? 0) === 0,
      })
      .select("id, label, provider, phone_number, status, wsapi_instance_id")
      .single();

    if (error || !row) {
      // Instance already connected to some account (unique index).
      const msg = /duplicate|unique/i.test(error?.message ?? "")
        ? "That wsapi.chat instance is already connected."
        : "Failed to save the number.";
      return NextResponse.json({ error: msg }, { status: 409 });
    }

    return NextResponse.json({
      success: true,
      number: row,
      connected: status.isConnected && status.isLoggedIn,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
