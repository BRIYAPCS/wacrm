// ============================================================
// GET    /api/whatsapp/link/[id]  — poll pairing status (admin+)
// DELETE /api/whatsapp/link/[id]  — unlink + remove the number (admin+)
//
// PROVIDER-AGNOSTIC: works for any QR-paired provider (wsapi, waha). The row's
// `provider` decides which gateway to talk to; the tenant never learns which.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { decrypt } from "@/lib/whatsapp/encryption";
import { wsapiSessionStatus, wsapiLogout } from "@/lib/wsapi/management";
import { jidToPhone } from "@/lib/wsapi/config";
import { WsapiError } from "@/lib/wsapi/client";
import { wahaSessionStatus, wahaDeleteSession } from "@/lib/waha/management";
import { wahaBaseUrl } from "@/lib/waha/config";
import { WahaError } from "@/lib/waha/client";

export const runtime = "nodejs";

async function loadRow(id: string) {
  const ctx = await requireRole("admin");
  const { data } = await ctx.supabase
    .from("whatsapp_config")
    .select(
      "id, provider, wsapi_instance_id, waha_session, base_url, access_token, status, phone_number",
    )
    .eq("id", id)
    .eq("account_id", ctx.accountId)
    .in("provider", ["wsapi", "waha"])
    .maybeSingle();
  return { ctx, row: data };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { ctx, row } = await loadRow(id);
    if (!row) return NextResponse.json({ error: "Number not found" }, { status: 404 });

    let connected = false;
    let phone: string | null = row.phone_number;
    try {
      if (row.provider === "waha") {
        const st = await wahaSessionStatus({
          baseUrl: wahaBaseUrl(row.base_url),
          apiKey: decrypt(row.access_token),
          session: row.waha_session as string,
        });
        connected = st.connected;
        phone = st.phone ?? row.phone_number;
      } else {
        const st = await wsapiSessionStatus({
          instanceId: row.wsapi_instance_id as string,
          apiKey: decrypt(row.access_token),
        });
        connected = st.isConnected && st.isLoggedIn;
        phone = st.deviceId ? jidToPhone(st.deviceId) : row.phone_number;
      }
    } catch (err) {
      if (err instanceof WsapiError || err instanceof WahaError) {
        return NextResponse.json({ connected: false, error: err.message });
      }
      throw err;
    }

    // Keep the stored row in sync with reality.
    const nextStatus = connected ? "connected" : "disconnected";
    if (row.status !== nextStatus || (phone && phone !== row.phone_number)) {
      await ctx.supabase
        .from("whatsapp_config")
        .update({
          status: nextStatus,
          phone_number: phone ?? row.phone_number,
          connected_at: connected ? new Date().toISOString() : null,
        })
        .eq("id", id);
    }

    return NextResponse.json({ connected, phone });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { ctx, row } = await loadRow(id);
    if (!row) return NextResponse.json({ error: "Number not found" }, { status: 404 });

    // Best-effort: free the session on the provider's side before deleting.
    if (row.provider === "waha") {
      await wahaDeleteSession({
        baseUrl: wahaBaseUrl(row.base_url),
        apiKey: decrypt(row.access_token),
        session: row.waha_session as string,
      });
    } else {
      await wsapiLogout({
        instanceId: row.wsapi_instance_id as string,
        apiKey: decrypt(row.access_token),
      });
    }

    const { error } = await ctx.supabase
      .from("whatsapp_config")
      .delete()
      .eq("id", id)
      .eq("account_id", ctx.accountId);
    if (error) {
      return NextResponse.json({ error: "Failed to remove the number" }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
