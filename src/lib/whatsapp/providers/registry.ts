// ============================================================
// WhatsApp provider registry — the single list of supported gateways and
// their capabilities. Mirrors the AI provider registry pattern
// (src/lib/ai/providers/registry.ts): adding a provider is a one-entry
// change here plus its adapter module.
//
// NOTE: provider identity is a PLATFORM concern. Tenants never see which
// provider a number uses (it reveals cost/margin) — only the superadmin
// console does. Keep provider labels out of tenant-facing UI.
// ============================================================

export type WhatsAppProviderId = "meta" | "twilio" | "wsapi";

export interface WhatsAppProviderMeta {
  id: WhatsAppProviderId;
  /** Human label — superadmin console only. */
  label: string;
  /** Pairs by scanning a QR from the customer's own WhatsApp (Baileys). */
  needsQr: boolean;
  /** Supports Meta-approved message templates. */
  supportsTemplates: boolean;
}

export const WHATSAPP_PROVIDERS: Record<WhatsAppProviderId, WhatsAppProviderMeta> = {
  meta: { id: "meta", label: "Meta Cloud API", needsQr: false, supportsTemplates: true },
  twilio: { id: "twilio", label: "Twilio", needsQr: false, supportsTemplates: true },
  wsapi: { id: "wsapi", label: "wsapi.chat", needsQr: true, supportsTemplates: false },
};

export const WHATSAPP_PROVIDER_IDS = Object.keys(
  WHATSAPP_PROVIDERS,
) as WhatsAppProviderId[];

export function isWhatsAppProvider(v: unknown): v is WhatsAppProviderId {
  return typeof v === "string" && v in WHATSAPP_PROVIDERS;
}
