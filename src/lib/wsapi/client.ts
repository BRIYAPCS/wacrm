// ============================================================
// WSAPI send client (per-instance). Endpoints:
//   POST /messages/text   { to, text }
//   POST /messages/image  { to, url|data, caption }
// (Note: send-text field is `text`, NOT `message` as the quickstart doc
// shows — confirmed against the live API.)
// ============================================================

import {
  wsapiBaseUrl,
  wsapiHeaders,
  phoneToJid,
  type WsapiCreds,
} from "./config";

export class WsapiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "WsapiError";
  }
}

export interface SendResult {
  messageId: string | null;
  raw: unknown;
}

export async function wsapiRequest(
  creds: WsapiCreds,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  try {
    return await fetch(`${wsapiBaseUrl(creds)}${path}`, {
      method,
      headers: wsapiHeaders(creds),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new WsapiError(
      err instanceof Error ? err.message : "WSAPI request failed",
      502,
    );
  }
}

async function post(
  creds: WsapiCreds,
  path: string,
  body: unknown,
): Promise<SendResult> {
  const res = await wsapiRequest(creds, "POST", path, body);
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const detail =
      (json as { detail?: string; message?: string; error?: string } | null)?.detail ??
      (json as { message?: string } | null)?.message ??
      (json as { error?: string } | null)?.error ??
      text ??
      `HTTP ${res.status}`;
    throw new WsapiError(`WSAPI ${path}: ${detail}`, res.status);
  }
  const messageId =
    (json as { messageId?: string; id?: string; key?: { id?: string } } | null)?.messageId ??
    (json as { id?: string } | null)?.id ??
    (json as { key?: { id?: string } } | null)?.key?.id ??
    null;
  return { messageId, raw: json };
}

const toJid = (to: string) => (to.includes("@") ? to : phoneToJid(to));

/** Send a plain text message. */
export function wsapiSendText(
  creds: WsapiCreds,
  to: string,
  text: string,
): Promise<SendResult> {
  return post(creds, "/messages/text", { to: toJid(to), text });
}

/** Send an image by URL (with optional caption). */
export function wsapiSendImage(
  creds: WsapiCreds,
  to: string,
  url: string,
  caption?: string,
): Promise<SendResult> {
  return post(creds, "/messages/image", { to: toJid(to), url, caption });
}
