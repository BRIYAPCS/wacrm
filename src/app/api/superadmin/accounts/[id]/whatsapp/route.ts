// ============================================================
// GET  /api/superadmin/accounts/[id]/whatsapp  — list an account's numbers
// POST /api/superadmin/accounts/[id]/whatsapp  — provision a number
//
// Platform-admin only. Provider configuration + credentials live HERE (the
// vendor's concern), never in the tenant UI — so a tenant can't see which
// provider/cost is behind their WhatsApp. Cross-account, service-role.
// ============================================================

import { NextResponse } from "next/server";
import crypto from "node:crypto";

import { requirePlatformAdmin, NotPlatformAdminError } from "@/lib/auth/platform";
import { encrypt } from "@/lib/whatsapp/encryption";
import { isWhatsAppProvider } from "@/lib/whatsapp/providers/registry";
import {
  effectiveTier,
  parseOverrides,
  resolveEntitlements,
  checkLimit,
} from "@/lib/plans/entitlements";
import { wsapiSessionStatus } from "@/lib/wsapi/management";
import { jidToPhone } from "@/lib/wsapi/config";
import { WsapiError } from "@/lib/wsapi/client";
import { wahaEnsureSession } from "@/lib/waha/management";
import { WahaError } from "@/lib/waha/client";
import {
  isWahaConfigured,
  wahaEnvApiKey,
  wahaEnvBaseUrl,
  wahaWebhookHmacKey,
} from "@/lib/waha/config";

export const runtime = "nodejs";

/** The app's public base URL, for WAHA to POST webhooks back to us. */
function publicBaseUrl(req: Request): string {
  const explicit = (process.env.WAHA_WEBHOOK_URL ?? "").replace(/\/+$/, "");
  if (explicit) return explicit;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  return host ? `${proto}://${host}` : "";
}

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
      .select("owner_user_id, plan, plan_overrides")
      .eq("id", accountId)
      .maybeSingle();
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    // Provisioning respects the account's plan: the number of WhatsApp
    // numbers (all providers combined) is capped by its tier. Bump the plan
    // or add a plan_overrides["limits"]["whatsapp_numbers"] to go higher.
    const { count: numberCount } = await supabase
      .from("whatsapp_config")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId);
    const entitlements = resolveEntitlements(
      effectiveTier(account.plan as string | null, process.env.NEXT_PUBLIC_DEFAULT_PLAN ?? null),
      parseOverrides(account.plan_overrides),
    );
    const limit = checkLimit(entitlements, "whatsapp_numbers", numberCount ?? 0);
    if (!limit.allowed) {
      return NextResponse.json(
        {
          error: `This account's ${entitlements.tier} plan allows ${limit.limit} WhatsApp number(s). Upgrade the plan or add a whatsapp_numbers override.`,
          code: "plan_limit",
        },
        { status: 403 },
      );
    }

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
    } else if (provider === "wsapi") {
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
    } else {
      // waha — self-hosted. No credentials to paste: the WAHA server (base
      // URL + key) is platform infra from env. We just create a session on it
      // and the customer scans the QR. Fully provider-blind.
      if (!isWahaConfigured()) {
        return NextResponse.json(
          { error: "WAHA server is not configured. Set WAHA_BASE_URL and WAHA_API_KEY." },
          { status: 400 },
        );
      }
      const webhookBase = publicBaseUrl(req);
      if (!webhookBase) {
        return NextResponse.json(
          { error: "Could not determine the app's public URL for the WAHA webhook. Set WAHA_WEBHOOK_URL." },
          { status: 400 },
        );
      }
      const session = `acc${accountId.replace(/-/g, "").slice(0, 8)}_${crypto.randomBytes(4).toString("hex")}`;
      const baseUrl = wahaEnvBaseUrl();
      const apiKey = wahaEnvApiKey();
      try {
        await wahaEnsureSession(
          { baseUrl, apiKey, session },
          { webhookUrl: `${webhookBase}/api/waha/webhook`, hmacKey: wahaWebhookHmacKey() },
        );
      } catch (err) {
        if (err instanceof WahaError) {
          return NextResponse.json({ error: err.message }, { status: 400 });
        }
        throw err;
      }
      row.waha_session = session;
      row.base_url = baseUrl;
      row.access_token = encrypt(apiKey);
      row.status = "disconnected";
    }

    // First number becomes the account default.
    row.is_default = (numberCount ?? 0) === 0;

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
