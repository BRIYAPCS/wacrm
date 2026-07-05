// ============================================================
// POST /api/wsapi/test-send  (admin+)
//
// Sends a WhatsApp message through WSAPI to verify outbound works, without
// touching the inbox/Meta send path. Body: { to, message }.
//   to      — phone (e.g. "12408017036") or a full JID
//   message — text
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { wsapiEnvCreds } from "@/lib/wsapi/config";
import { wsapiSendText, WsapiError } from "@/lib/wsapi/client";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireRole("admin");
    const creds = wsapiEnvCreds();
    if (!creds) {
      return NextResponse.json(
        { error: "Set WSAPI_API_KEY + WSAPI_INSTANCE_ID to use the env test-send." },
        { status: 400 },
      );
    }

    const body = (await request.json().catch(() => null)) as
      | { to?: unknown; message?: unknown }
      | null;
    const to = typeof body?.to === "string" ? body.to.trim() : "";
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!to || !message) {
      return NextResponse.json({ error: "'to' and 'message' are required" }, { status: 400 });
    }

    const result = await wsapiSendText(creds, to, message);
    return NextResponse.json({ success: true, messageId: result.messageId });
  } catch (err) {
    if (err instanceof WsapiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return toErrorResponse(err);
  }
}
