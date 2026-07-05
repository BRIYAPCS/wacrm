// ============================================================
// WAHA HTTP client — send + low-level request helper.
//
// Endpoints (WAHA docs, live-verified against our GOWS server):
//   POST /api/sendText   { session, chatId, text }
//   POST /api/sendImage  { session, chatId, file:{ url }, caption }
// A successful send returns the created message; we surface its id.
// ============================================================

import {
  wahaBaseUrl,
  wahaHeaders,
  phoneToChatId,
  type WahaCreds,
} from "./config";

export class WahaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "WahaError";
  }
}

export interface SendResult {
  messageId: string | null;
  raw: unknown;
}

export async function wahaRequest(
  creds: WahaCreds,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  try {
    return await fetch(`${wahaBaseUrl(creds.baseUrl)}${path}`, {
      method,
      headers: wahaHeaders(creds),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new WahaError(
      err instanceof Error ? err.message : "WAHA request failed",
      502,
    );
  }
}

async function post(
  creds: WahaCreds,
  path: string,
  body: unknown,
): Promise<SendResult> {
  const res = await wahaRequest(creds, "POST", path, body);
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const detail =
      (json as { message?: string; error?: string } | null)?.message ??
      (json as { error?: string } | null)?.error ??
      text ??
      `HTTP ${res.status}`;
    throw new WahaError(`WAHA ${path}: ${detail}`, res.status);
  }
  // WAHA returns the message envelope; the id lives under `id` (string) or
  // a nested `id._serialized` / `key.id` depending on engine. Parse widely.
  const j = json as
    | {
        id?: string | { _serialized?: string; id?: string };
        key?: { id?: string };
        _data?: { id?: { _serialized?: string } };
      }
    | null;
  const messageId =
    (typeof j?.id === "string" ? j.id : undefined) ??
    (typeof j?.id === "object" ? (j.id._serialized ?? j.id.id) : undefined) ??
    j?.key?.id ??
    j?._data?.id?._serialized ??
    null;
  return { messageId, raw: json };
}

const toChatId = (to: string) => (to.includes("@") ? to : phoneToChatId(to));

/** Send a plain text message. */
export function wahaSendText(
  creds: WahaCreds,
  to: string,
  text: string,
): Promise<SendResult> {
  return post(creds, "/api/sendText", {
    session: creds.session,
    chatId: toChatId(to),
    text,
  });
}

/** Send an image by URL (with optional caption). */
export function wahaSendImage(
  creds: WahaCreds,
  to: string,
  url: string,
  caption?: string,
): Promise<SendResult> {
  return post(creds, "/api/sendImage", {
    session: creds.session,
    chatId: toChatId(to),
    file: { url },
    caption,
  });
}

// ============================================================
// History sync — list the account's existing chats + fetch a chat's messages.
// Live-verified shapes against the GOWS server.
//   GET /api/{session}/chats/overview?limit=N        → WahaChatOverview[]
//   GET /api/{session}/chats/{chatId}/messages?...   → WahaHistoryMessage[]
// ============================================================

/** A message as returned by the chats/messages endpoints — same shape the
 *  webhook receives, so the ingest/sync paths can share resolution logic. */
export interface WahaHistoryMessage {
  id?: string;
  timestamp?: number;
  from?: string;
  to?: string | null;
  fromMe?: boolean;
  body?: string;
  hasMedia?: boolean;
  type?: string | null;
  ack?: number;
  ackName?: string;
  _data?: {
    Info?: {
      Chat?: string;
      Sender?: string;
      SenderAlt?: string;
      RecipientAlt?: string;
      IsFromMe?: boolean;
      IsGroup?: boolean;
      ID?: string;
      Type?: string;
      MediaType?: string;
      PushName?: string;
    };
    notifyName?: string;
    pushName?: string;
    notify?: string;
  };
  notifyName?: string;
}

export interface WahaChatOverview {
  id: string;
  name?: string | null;
  picture?: string | null;
  lastMessage?: WahaHistoryMessage | null;
}

const enc = encodeURIComponent;

async function getArray<T>(creds: WahaCreds, path: string): Promise<T[]> {
  const res = await wahaRequest(creds, "GET", path);
  const text = await res.text();
  if (!res.ok) {
    throw new WahaError(`WAHA ${path}: HTTP ${res.status}`, res.status);
  }
  try {
    const j = JSON.parse(text);
    return Array.isArray(j) ? (j as T[]) : [];
  } catch {
    return [];
  }
}

/** List the connected number's chats (contacts + groups), newest first. */
export function wahaListChats(
  creds: WahaCreds,
  limit = 500,
): Promise<WahaChatOverview[]> {
  return getArray<WahaChatOverview>(
    creds,
    `/api/${enc(creds.session)}/chats/overview?limit=${limit}`,
  );
}

/** Fetch a chat's message history (newest first). Media is not downloaded —
 *  the sync stores a marker, mirroring inbound-webhook behaviour. */
export function wahaFetchMessages(
  creds: WahaCreds,
  chatId: string,
  limit: number,
): Promise<WahaHistoryMessage[]> {
  return getArray<WahaHistoryMessage>(
    creds,
    `/api/${enc(creds.session)}/chats/${enc(chatId)}/messages?limit=${limit}&downloadMedia=false`,
  );
}
