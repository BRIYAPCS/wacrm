// ============================================================
// GET /api/whatsapp/link/[id]/qr  (admin+)
//
// Returns the pairing QR (a data:image/png URL) for a QR-paired number, or
// { connected:true, qr:null } when it's already paired. PROVIDER-AGNOSTIC
// (wsapi, waha) — the tenant never learns which gateway is behind the number.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { decrypt } from "@/lib/whatsapp/encryption";
import { wsapiQrImage, wsapiSessionStatus } from "@/lib/wsapi/management";
import { WsapiError } from "@/lib/wsapi/client";
import { wahaScanState } from "@/lib/waha/management";
import { wahaBaseUrl } from "@/lib/waha/config";
import { WahaError } from "@/lib/waha/client";

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
      .select("provider, wsapi_instance_id, waha_session, base_url, access_token")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .in("provider", ["wsapi", "waha"])
      .maybeSingle();
    if (!row) return NextResponse.json({ error: "Number not found" }, { status: 404 });

    try {
      if (row.provider === "waha") {
        const state = await wahaScanState({
          baseUrl: wahaBaseUrl(row.base_url),
          apiKey: decrypt(row.access_token),
          session: row.waha_session as string,
        });
        return NextResponse.json(state);
      }

      const creds = {
        instanceId: row.wsapi_instance_id as string,
        apiKey: decrypt(row.access_token),
      };
      const st = await wsapiSessionStatus(creds);
      if (st.isConnected && st.isLoggedIn) {
        return NextResponse.json({ connected: true, qr: null });
      }
      const qr = await wsapiQrImage(creds);
      return NextResponse.json({ connected: false, qr });
    } catch (err) {
      if (err instanceof WsapiError || err instanceof WahaError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
