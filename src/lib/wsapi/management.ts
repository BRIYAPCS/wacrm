// ============================================================
// WSAPI session management — pairing (QR), status, logout.
// Per-instance (uses the instance's own credentials).
//
// Live-verified shapes:
//   GET  /session/status        -> { deviceId, isConnected, isLoggedIn }
//   GET  /session/qr-code/text  -> raw QR string while pairing; 404 when
//                                  already connected (→ we return null)
//   POST /session/logout        -> disconnect the paired device
// ============================================================

import { wsapiRequest, WsapiError } from "./client";
import type { WsapiCreds } from "./config";

export interface WsapiStatus {
  deviceId: string | null;
  isConnected: boolean;
  isLoggedIn: boolean;
}

export async function wsapiSessionStatus(creds: WsapiCreds): Promise<WsapiStatus> {
  const res = await wsapiRequest(creds, "GET", "/session/status");
  if (!res.ok) {
    // 401/403 → bad creds; surface a clear error.
    const body = await res.text().catch(() => "");
    throw new WsapiError(
      res.status === 401 || res.status === 403
        ? "Invalid WSAPI instance id or API key."
        : `WSAPI status ${res.status}: ${body}`,
      res.status,
    );
  }
  const json = (await res.json().catch(() => ({}))) as Partial<WsapiStatus>;
  return {
    deviceId: json.deviceId ?? null,
    isConnected: Boolean(json.isConnected),
    isLoggedIn: Boolean(json.isLoggedIn),
  };
}

/**
 * The pairing QR as a `data:image/png;base64,…` URL (WSAPI renders the PNG
 * for us), or null when already connected. Lets the client just drop it into
 * an <img> — no QR library needed.
 */
export async function wsapiQrImage(creds: WsapiCreds): Promise<string | null> {
  const res = await wsapiRequest(creds, "GET", "/session/qr-code");
  if (res.status === 404) return null; // already paired
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new WsapiError(`WSAPI qr ${res.status}: ${body}`, res.status);
  }
  const contentType = res.headers.get("content-type") || "image/png";
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) return null;
  return `data:${contentType};base64,${buf.toString("base64")}`;
}

/** The QR string to render while pairing, or null when already connected. */
export async function wsapiQrText(creds: WsapiCreds): Promise<string | null> {
  const res = await wsapiRequest(creds, "GET", "/session/qr-code/text");
  if (res.status === 404) return null; // no QR → already paired/connected
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new WsapiError(`WSAPI qr ${res.status}: ${body}`, res.status);
  }
  const text = await res.text();
  // Endpoint may return raw text or a JSON wrapper — handle both.
  try {
    const j = JSON.parse(text) as { qr?: string; qrCode?: string; data?: string };
    return j.qr ?? j.qrCode ?? j.data ?? text;
  } catch {
    return text.trim() || null;
  }
}

export async function wsapiLogout(creds: WsapiCreds): Promise<void> {
  await wsapiRequest(creds, "POST", "/session/logout").catch(() => {});
}
