// ============================================================
// WAHA session lifecycle — create/ensure a session, read its status, fetch
// the pairing QR, log out. Live-verified against a WAHA GOWS (CORE) server.
//
// Endpoints:
//   POST   /api/sessions                       create (+start) with webhooks
//   PUT    /api/sessions/{session}             update config (webhook re-point)
//   POST   /api/sessions/{session}/start       start a stopped session
//   POST   /api/sessions/{session}/logout      unlink the phone
//   DELETE /api/sessions/{session}             remove the session entirely
//   GET    /api/sessions/{session}             status + `me` when WORKING
//   GET    /api/{session}/auth/qr  (Accept json) → { mimetype, data(base64) }
//
// Status values: STOPPED | STARTING | SCAN_QR_CODE | WORKING | FAILED.
// ============================================================

import { wahaRequest, WahaError } from "./client";
import { chatIdToPhone, type WahaCreds } from "./config";

export interface WahaStatus {
  /** Raw WAHA status (STOPPED|STARTING|SCAN_QR_CODE|WORKING|FAILED). */
  raw: string;
  /** True only when the session is fully paired and online. */
  connected: boolean;
  /** The linked phone (from `me.id`) once WORKING, else null. */
  phone: string | null;
  pushName: string | null;
}

interface SessionJson {
  status?: string;
  me?: { id?: string; pushName?: string } | null;
}

export async function wahaSessionStatus(creds: WahaCreds): Promise<WahaStatus> {
  const res = await wahaRequest(
    creds,
    "GET",
    `/api/sessions/${encodeURIComponent(creds.session)}`,
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new WahaError(
      res.status === 401 || res.status === 403
        ? "Invalid WAHA API key."
        : res.status === 404
          ? "WAHA session not found."
          : `WAHA status ${res.status}: ${body}`,
      res.status,
    );
  }
  const json = (await res.json().catch(() => ({}))) as SessionJson;
  const raw = json.status ?? "STOPPED";
  return {
    raw,
    connected: raw === "WORKING",
    phone: json.me?.id ? chatIdToPhone(json.me.id) : null,
    pushName: json.me?.pushName ?? null,
  };
}

/** Build the WAHA session config with our inbound webhook + HMAC. */
function sessionConfig(webhookUrl: string, hmacKey: string) {
  const webhook: Record<string, unknown> = {
    url: webhookUrl,
    events: ["message", "session.status"],
  };
  if (hmacKey) webhook.hmac = { key: hmacKey };
  return { webhooks: [webhook] };
}

/**
 * Create-or-update the session so it's started and points its webhook at us.
 * Idempotent: if the session already exists we update its config and (re)start
 * it rather than failing.
 */
export async function wahaEnsureSession(
  creds: WahaCreds,
  opts: { webhookUrl: string; hmacKey: string },
): Promise<void> {
  const config = sessionConfig(opts.webhookUrl, opts.hmacKey);

  const created = await wahaRequest(creds, "POST", "/api/sessions", {
    name: creds.session,
    start: true,
    config,
  });
  if (created.ok) return;

  // Already exists (or a transient create error) → update config + start.
  if ([400, 409, 422].includes(created.status)) {
    await wahaRequest(
      creds,
      "PUT",
      `/api/sessions/${encodeURIComponent(creds.session)}`,
      { config },
    ).catch(() => {});
    await wahaStartSession(creds);
    return;
  }

  const body = await created.text().catch(() => "");
  throw new WahaError(`WAHA create session ${created.status}: ${body}`, created.status);
}

export async function wahaStartSession(creds: WahaCreds): Promise<void> {
  await wahaRequest(
    creds,
    "POST",
    `/api/sessions/${encodeURIComponent(creds.session)}/start`,
  ).catch(() => {});
}

/**
 * The pairing QR as a `data:image/png;base64,…` URL, or null when there's no
 * QR to show (already paired, or the session isn't in a scan state).
 */
export async function wahaQrImage(creds: WahaCreds): Promise<string | null> {
  const res = await wahaRequest(
    creds,
    "GET",
    `/api/${encodeURIComponent(creds.session)}/auth/qr`,
  );
  // Any non-2xx (e.g. 422 when WORKING) → no QR to render.
  if (!res.ok) return null;

  const json = (await res.json().catch(() => null)) as
    | { mimetype?: string; data?: string }
    | null;
  if (!json?.data) return null;
  return `data:${json.mimetype || "image/png"};base64,${json.data}`;
}

/** Unlink the phone from the session (keeps the session, drops the pairing). */
export async function wahaLogout(creds: WahaCreds): Promise<void> {
  await wahaRequest(
    creds,
    "POST",
    `/api/sessions/${encodeURIComponent(creds.session)}/logout`,
  ).catch(() => {});
}

/** Remove the session entirely from the WAHA server (best-effort). */
export async function wahaDeleteSession(creds: WahaCreds): Promise<void> {
  await wahaRequest(
    creds,
    "DELETE",
    `/api/sessions/${encodeURIComponent(creds.session)}`,
  ).catch(() => {});
}
