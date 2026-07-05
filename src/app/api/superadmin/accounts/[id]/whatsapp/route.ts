// ============================================================
// GET  /api/superadmin/accounts/[id]/whatsapp  — list an account's numbers
// POST /api/superadmin/accounts/[id]/whatsapp  — provision a number
//
// Platform-admin only. Provider configuration + credentials live HERE (the
// vendor's concern), never in the tenant UI — so a tenant can't see which
// provider/cost is behind their WhatsApp. Cross-account, service-role.
// ============================================================

import { NextResponse } from "next/server";

import { requirePlatformAdmin, NotPlatformAdminError } from "@/lib/auth/platform";
import { encrypt } from "@/lib/whatsapp/encryption";
import { isWhatsAppProvider } from "@/lib/whatsapp/providers/registry";
import { wsapiSessionStatus } from "@/lib/wsapi/management";
import { jidToPhone } from "@/lib/wsapi/config";
import { WsapiError } from "@/lib/wsapi/client";

export const runtime = "nodejs";

function fail(err: unknown) {
  if (err instanceof NotPlatformAdminError) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  console.error("[superadmin whatsapp]", err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase } = await requirePlatformAdmin();
    const { id: accountId } = await params;
    const { data } = await supabase
      .from("whatsapp_config")
      .select("id, provider, label, phone_number, wsapi_instance_id, provider_account_id, is_default, status, created_at")
      .eq("account_id", accountId)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true });
    return NextResponse.json({ numbers: data ?? [] });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase } = await requirePlatformAdmin();
    const { id: accountId } = await params;

    // The account owner is the audit/attribution user for provisioned rows.
    const { data: account } = await supabase
      .from("accounts")
      .select("owner_user_id")
      .eq("id", accountId)
      .maybeSingle();
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const provider = body?.provider;
    if (!isWhatsAppProvider(provider)) {
      return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
    }
    const label =
      typeof body?.label === "string" && body.label.trim()
        ? body.label.trim().slice(0, 60)
        : "WhatsApp";

    // Build the provider-specific row.
    const row: Record<string, unknown> = {
      account_id: accountId,
      user_id: account.owner_user_id,
      provider,
      label,
      status: "disconnected",
    };

    if (provider === "meta") {
      const phoneNumberId = String(body?.phoneNumberId ?? "").trim();
      const token = String(body?.accessToken ?? "").trim();
      if (!phoneNumberId || !token) {
        return NextResponse.json({ error: "phoneNumberId and accessToken are required" }, { status: 400 });
      }
      row.phone_number_id = phoneNumberId;
      row.access_token = encrypt(token);
      row.waba_id = String(body?.wabaId ?? "").trim() || null;
      row.status = "connected";
      row.connected_at = new Date().toISOString();
    } else if (provider === "twilio") {
      const accountSid = String(body?.accountSid ?? "").trim();
      const authToken = String(body?.authToken ?? "").trim();
      const from = String(body?.from ?? "").trim();
      if (!accountSid || !authToken || !from) {
        return NextResponse.json({ error: "accountSid, authToken and from are required" }, { status: 400 });
      }
      row.provider_account_id = accountSid;
      row.access_token = encrypt(authToken);
      row.phone_number = from.startsWith("+") ? from : `+${from.replace(/[^\d]/g, "")}`;
      row.status = "connected";
      row.connected_at = new Date().toISOString();
    } else {
      // wsapi — verify the instance, then it may still need a QR scan.
      const instanceId = String(body?.instanceId ?? "").trim();
      const apiKey = String(body?.apiKey ?? "").trim();
      if (!instanceId || !apiKey) {
        return NextResponse.json({ error: "instanceId and apiKey are required" }, { status: 400 });
      }
      try {
        const st = await wsapiSessionStatus({ instanceId, apiKey });
        row.status = st.isConnected && st.isLoggedIn ? "connected" : "disconnected";
        row.phone_number = st.deviceId ? jidToPhone(st.deviceId) : null;
        if (row.status === "connected") row.connected_at = new Date().toISOString();
      } catch (err) {
        if (err instanceof WsapiError) {
          return NextResponse.json({ error: err.message }, { status: 400 });
        }
        throw err;
      }
      row.wsapi_instance_id = instanceId;
      row.access_token = encrypt(apiKey);
    }

    // First number becomes the account default.
    const { count } = await supabase
      .from("whatsapp_config")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId);
    row.is_default = (count ?? 0) === 0;

    const { data: inserted, error } = await supabase
      .from("whatsapp_config")
      .insert(row)
      .select("id, provider, label, status")
      .single();
    if (error || !inserted) {
      const msg = /duplicate|unique/i.test(error?.message ?? "")
        ? "That number/instance is already connected."
        : "Failed to add the number.";
      return NextResponse.json({ error: msg }, { status: 409 });
    }

    return NextResponse.json({ success: true, number: inserted });
  } catch (err) {
    return fail(err);
  }
}
