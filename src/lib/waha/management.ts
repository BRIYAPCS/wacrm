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

  // WAHA content-negotiates this endpoint: JSON `{mimetype,data}` with an
  // Accept: application/json, but a raw binary PNG by default. Handle both so
  // we don't depend on header negotiation.
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const json = (await res.json().catch(() => null)) as
      | { mimetype?: string; data?: string }
      | null;
    if (!json?.data) return null;
    return `data:${json.mimetype || "image/png"};base64,${json.data}`;
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) return null;
  return `data:${contentType || "image/png"};base64,${buf.toString("base64")}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve a scannable state for the pairing UI, self-healing along the way.
 * WhatsApp expires each QR quickly and GOWS drops the session to FAILED after
 * a few unscanned cycles, so we:
 *   • report `connected` once WORKING,
 *   • (re)start a STOPPED/FAILED session,
 *   • briefly wait for the QR to be minted after a (re)start,
 * returning `qr: null` (still generating) rather than an error if it isn't
 * ready yet — the client shows a "generating" state and polls again.
 */
export async function wahaScanState(
  creds: WahaCreds,
): Promise<{ connected: boolean; qr: string | null }> {
  const st = await wahaSessionStatus(creds);
  if (st.connected) return { connected: true, qr: null };
  if (st.raw === "STOPPED" || st.raw === "FAILED") await wahaStartSession(creds);

  // A freshly (re)started session needs a moment before the QR exists.
  for (let i = 0; i < 4; i++) {
    const qr = await wahaQrImage(creds);
    if (qr) return { connected: false, qr };
    const again = await wahaSessionStatus(creds);
    if (again.connected) return { connected: true, qr: null };
    if (i < 3) await sleep(700);
  }
  return { connected: false, qr: null };
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
