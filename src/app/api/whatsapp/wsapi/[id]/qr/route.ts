// ============================================================
// GET /api/whatsapp/wsapi/[id]/qr  (admin+)
//
// Returns the pairing QR string for a wsapi.chat number to render in the
// UI, or { connected:true } when it's already paired (no QR needed).
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { decrypt } from "@/lib/whatsapp/encryption";
import { wsapiQrImage, wsapiSessionStatus } from "@/lib/wsapi/management";
import { WsapiError } from "@/lib/wsapi/client";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ctx = await requireRole("admin");
    const { data: row } = await ctx.supabase
      .from("whatsapp_config")
      .select("wsapi_instance_id, access_token")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .eq("provider", "wsapi")
      .maybeSingle();
    if (!row) return NextResponse.json({ error: "Number not found" }, { status: 404 });

    const creds = {
      instanceId: row.wsapi_instance_id as string,
      apiKey: decrypt(row.access_token),
    };

    try {
      const status = await wsapiSessionStatus(creds);
      if (status.isConnected && status.isLoggedIn) {
        return NextResponse.json({ connected: true, qr: null });
      }
      const qr = await wsapiQrImage(creds);
      return NextResponse.json({ connected: false, qr });
    } catch (err) {
      if (err instanceof WsapiError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
