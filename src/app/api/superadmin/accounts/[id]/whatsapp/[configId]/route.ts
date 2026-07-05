// ============================================================
// DELETE /api/superadmin/accounts/[id]/whatsapp/[configId]
// Platform-admin only — remove a provisioned WhatsApp number.
// ============================================================

import { NextResponse } from "next/server";

import { requirePlatformAdmin, NotPlatformAdminError } from "@/lib/auth/platform";
import { decrypt } from "@/lib/whatsapp/encryption";
import { wsapiLogout } from "@/lib/wsapi/management";
import { wahaDeleteSession } from "@/lib/waha/management";
import { wahaBaseUrl } from "@/lib/waha/config";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; configId: string }> },
) {
  try {
    const { supabase } = await requirePlatformAdmin();
    const { id: accountId, configId } = await params;

    const { data: row } = await supabase
      .from("whatsapp_config")
      .select("id, provider, wsapi_instance_id, waha_session, base_url, access_token")
      .eq("id", configId)
      .eq("account_id", accountId)
      .maybeSingle();
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Best-effort: free the session on the provider's side before deleting.
    try {
      if (row.provider === "wsapi" && row.wsapi_instance_id) {
        await wsapiLogout({
          instanceId: row.wsapi_instance_id,
          apiKey: decrypt(row.access_token),
        });
      } else if (row.provider === "waha" && row.waha_session) {
        await wahaDeleteSession({
          baseUrl: wahaBaseUrl(row.base_url),
          apiKey: decrypt(row.access_token),
          session: row.waha_session,
        });
      }
    } catch (err) {
      console.warn("[superadmin whatsapp delete] provider cleanup failed:", err);
    }

    const { error } = await supabase
      .from("whatsapp_config")
      .delete()
      .eq("id", configId)
      .eq("account_id", accountId);
    if (error) return NextResponse.json({ error: "Failed to remove" }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof NotPlatformAdminError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("[superadmin whatsapp delete]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
