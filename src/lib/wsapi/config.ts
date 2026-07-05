// ============================================================
// WSAPI (wsapi.chat) shared config + helpers.
//
// Per-instance: every call carries the instance's own credentials
// (instance id + api key), so an account can connect several wsapi.chat
// numbers, each its own instance. The old env-based single-instance mode
// still works for the /api/wsapi/test-send helper.
// ============================================================

export interface WsapiCreds {
  instanceId: string;
  apiKey: string;
  /** Override the base URL per instance (rare); defaults to the global. */
  baseUrl?: string;
}

export function wsapiBaseUrl(creds?: { baseUrl?: string }): string {
  return (
    creds?.baseUrl ||
    process.env.WSAPI_BASE_URL ||
    "https://api.wsapi.chat"
  ).replace(/\/+$/, "");
}

/** The two auth headers every WSAPI request needs. */
export function wsapiHeaders(creds: WsapiCreds): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Api-Key": creds.apiKey,
    "X-Instance-Id": creds.instanceId,
  };
}

/** Env-based creds for the standalone test-send route (optional). */
export function wsapiEnvCreds(): WsapiCreds | null {
  const apiKey = process.env.WSAPI_API_KEY;
  const instanceId = process.env.WSAPI_INSTANCE_ID;
  if (!apiKey || !instanceId) return null;
  return { apiKey, instanceId };
}

/** True when the env-based test bridge is configured. */
export function isWsapiEnabled(): boolean {
  return process.env.WSAPI_ENABLED === "true" && !!wsapiEnvCreds();
}

/** WhatsApp JID (`<number>@s.whatsapp.net`) → a stored phone (`+<number>`). */
export function jidToPhone(jid: string): string {
  const num = jid.split("@")[0].split(":")[0].replace(/[^\d]/g, "");
  return num ? `+${num}` : jid;
}

/** A stored phone (`+1240…` or `1240…`) → a WSAPI JID. */
export function phoneToJid(phone: string): string {
  const num = phone.replace(/[^\d]/g, "");
  return `${num}@s.whatsapp.net`;
}
