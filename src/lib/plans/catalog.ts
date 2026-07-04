// ============================================================
// Plan catalogue — the single source of truth for what each tier includes.
//
// Pure + isomorphic: NO I/O, no `server-only`, no Supabase/next imports —
// so the SAME map is imported by the server guard (src/lib/auth/account.ts)
// and the client (src/hooks/use-auth.tsx). This mirrors how roles.ts shares
// one set of predicates across the JS/SQL boundary.
//
// The DB only stores which tier an account is on (accounts.plan) + any
// per-account overrides (accounts.plan_overrides). Everything about what a
// tier *means* lives here — change pricing/packaging by editing this file.
// ============================================================

export type PlanTier = "basic" | "pro" | "advanced";

/** Lowest tier first. */
export const PLAN_TIERS: readonly PlanTier[] = ["basic", "pro", "advanced"] as const;

/** Whole feature modules a tier can switch on/off. */
export type FeatureKey =
  | "ai" // AI assistant + knowledge base
  | "flows" // visual flow builder
  | "automations" // trigger/action automations
  | "public_api" // /api/v1 + API keys + outbound webhooks
  | "multi_number" // more than one connected WhatsApp number
  | "broadcasts" // bulk template sends
  | "audit_log" // account audit trail
  | "reports"; // analytics/reports

/** Numeric caps. `-1` means unlimited. Enforced server-side on create/add. */
export type LimitKey =
  | "seats" // team members + pending invites
  | "whatsapp_numbers"
  | "contacts"
  | "api_keys"
  | "kb_documents"
  | "kb_bytes"
  | "broadcast_recipients" // per single broadcast
  | "pipelines";

export interface PlanDefinition {
  /** Every FeatureKey must be present — the exhaustive Record enforces it. */
  features: Record<FeatureKey, boolean>;
  /** Every LimitKey must be present. `-1` = unlimited. */
  limits: Record<LimitKey, number>;
}

/** Sentinel for "no cap". */
export const UNLIMITED = -1;

// The matrix. Editing these values re-packages the tiers — nothing else
// needs to change. (Values are a product decision; tune freely.)
export const PLANS: Record<PlanTier, PlanDefinition> = {
  basic: {
    features: {
      ai: false,
      flows: false,
      automations: false,
      public_api: false,
      multi_number: false,
      broadcasts: true,
      audit_log: false,
      reports: true,
    },
    limits: {
      seats: 2,
      whatsapp_numbers: 1,
      contacts: 1_000,
      api_keys: 0,
      kb_documents: 0,
      kb_bytes: 0,
      broadcast_recipients: 250,
      pipelines: 1,
    },
  },
  pro: {
    features: {
      ai: true,
      flows: false,
      automations: true,
      public_api: false,
      multi_number: true,
      broadcasts: true,
      audit_log: false,
      reports: true,
    },
    limits: {
      seats: 10,
      whatsapp_numbers: 3,
      contacts: 25_000,
      api_keys: 0,
      kb_documents: 50,
      kb_bytes: 50 * 1024 * 1024,
      broadcast_recipients: 1_000,
      pipelines: 10,
    },
  },
  advanced: {
    features: {
      ai: true,
      flows: true,
      automations: true,
      public_api: true,
      multi_number: true,
      broadcasts: true,
      audit_log: true,
      reports: true,
    },
    limits: {
      seats: UNLIMITED,
      whatsapp_numbers: UNLIMITED,
      contacts: UNLIMITED,
      api_keys: 10,
      kb_documents: UNLIMITED,
      kb_bytes: UNLIMITED,
      broadcast_recipients: 5_000,
      pipelines: UNLIMITED,
    },
  },
};

/** The tier existing/unknown accounts fall back to (fail-open — see plan). */
export const DEFAULT_TIER: PlanTier = "advanced";

export function isPlanTier(value: unknown): value is PlanTier {
  return typeof value === "string" && (PLAN_TIERS as readonly string[]).includes(value);
}

/** Rank (basic=1 … advanced=3), mirroring roleRank in roles.ts. */
export function planRank(tier: PlanTier): number {
  switch (tier) {
    case "basic":
      return 1;
    case "pro":
      return 2;
    case "advanced":
      return 3;
  }
}

/** Human label for UI. */
export const PLAN_LABELS: Record<PlanTier, string> = {
  basic: "Basic",
  pro: "Pro",
  advanced: "Advanced",
};
