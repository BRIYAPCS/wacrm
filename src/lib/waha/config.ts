// ============================================================
// WAHA (self-hosted WhatsApp HTTP API) — per-instance credentials + helpers.
//
// The WAHA server is PLATFORM infrastructure (a Docker container we run), so
// the base URL, API key and webhook HMAC key live in env and are shared by
// every session. Each whatsapp_config row of provider='waha' carries only its
// own `waha_session` name (and optionally an overriding base_url), never a
// tenant-visible secret. Tenants stay provider-blind.
//
// WAHA auth: a single `X-Api-Key` header (docs: how-to/security). Addressing:
// individual chats are `<number>@c.us` (docs: how-to/send-messages).
// ============================================================

export interface WahaCreds {
  /** Base URL of the WAHA server, e.g. "http://1.2.3.4:3000" (no trailing /). */
  baseUrl: string;
  /** Plain API key sent as X-Api-Key (the server stores only its sha512). */
  apiKey: string;
  /** The WAHA session name this number is paired on. */
  session: string;
}

/** The platform-default WAHA base URL from env (per-row base_url overrides). */
export function wahaEnvBaseUrl(): string {
  return (process.env.WAHA_BASE_URL ?? "").replace(/\/+$/, "");
}

/** The platform-default WAHA API key from env. */
export function wahaEnvApiKey(): string {
  return process.env.WAHA_API_KEY ?? "";
}

/** Shared secret WAHA signs webhooks with (config.webhooks[].hmac.key). */
export function wahaWebhookHmacKey(): string {
  return process.env.WAHA_WEBHOOK_HMAC_KEY ?? "";
}

/**
 * True when the platform has a WAHA server configured (base URL + key). The
 * superadmin can only provision WAHA numbers when this is set.
 */
export function isWahaConfigured(): boolean {
  return Boolean(wahaEnvBaseUrl() && wahaEnvApiKey());
}

/** Normalize a base URL (env default when blank), stripping trailing slashes. */
export function wahaBaseUrl(baseUrl?: string | null): string {
  return (baseUrl?.trim() || wahaEnvBaseUrl()).replace(/\/+$/, "");
}

/** The one auth header every WAHA request needs. */
export function wahaHeaders(creds: WahaCreds): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Api-Key": creds.apiKey,
  };
}

/** A stored phone (`+1240…` or `1240…`) → a WAHA individual chatId. */
export function phoneToChatId(phone: string): string {
  const num = phone.replace(/[^\d]/g, "");
  return `${num}@c.us`;
}

/** A WAHA chatId/JID (`<num>@c.us`) → a stored phone (`+<num>`). */
export function chatIdToPhone(chatId: string): string {
  const num = chatId.split("@")[0].split(":")[0].replace(/[^\d]/g, "");
  return num ? `+${num}` : chatId;
}
