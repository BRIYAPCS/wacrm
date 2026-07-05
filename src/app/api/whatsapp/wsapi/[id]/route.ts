// ============================================================
// GET    /api/whatsapp/wsapi/[id]  — poll session status (admin+)
// DELETE /api/whatsapp/wsapi/[id]  — logout + remove the number (admin+)
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { decrypt } from "@/lib/whatsapp/encryption";
import { wsapiSessionStatus, wsapiLogout } from "@/lib/wsapi/management";
import { jidToPhone } from "@/lib/wsapi/config";
import { WsapiError } from "@/lib/wsapi/client";

export const runtime = "nodejs";

async function loadRow(id: string) {
  const ctx = await requireRole("admin");
  const { data, error } = await ctx.supabase
    .from("whatsapp_config")
    .select("id, wsapi_instance_id, access_token, status, phone_number")
    .eq("id", id)
    .eq("account_id", ctx.accountId)
    .eq("provider", "wsapi")
    .maybeSingle();
  if (error || !data) return { ctx, row: null };
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

    let status;
    try {
      status = await wsapiSessionStatus({
        instanceId: row.wsapi_instance_id as string,
        apiKey: decrypt(row.access_token),
      });
    } catch (err) {
      if (err instanceof WsapiError) {
        return NextResponse.json({ connected: false, error: err.message });
      }
      throw err;
    }

    const connected = status.isConnected && status.isLoggedIn;
    const phone = status.deviceId ? jidToPhone(status.deviceId) : row.phone_number;

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

    // Best-effort logout so the WhatsApp session is freed on WSAPI's side.
    await wsapiLogout({
      instanceId: row.wsapi_instance_id as string,
      apiKey: decrypt(row.access_token),
    });

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
