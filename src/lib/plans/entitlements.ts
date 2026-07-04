// ============================================================
// Entitlement resolver — turns (plan + overrides) into a concrete set of
// features + limits. Pure + isomorphic (imported by server and client).
//
// Resolution/precedence (highest first), applied by the callers that have
// the data:
//   accounts.plan_overrides  (per-key)   ← merged here
//   accounts.plan            (the tier)  ← `plan` arg
//   instance default (env DEFAULT_PLAN)  ← folded into `plan` by the caller
//   'advanced'                           ← final fail-open fallback
//
// Fail-OPEN to 'advanced' on unknown/NULL plan is intentional and the
// opposite of roles (which fail closed): tiers gate *features*, never
// tenant data (RLS still isolates tenants regardless of plan), so the worst
// case of a bad plan value is "a paying customer keeps features", not a
// security hole.
// ============================================================

import {
  DEFAULT_TIER,
  PLANS,
  isPlanTier,
  type FeatureKey,
  type LimitKey,
  type PlanTier,
} from "./catalog";

/** Per-account overrides stored in accounts.plan_overrides (jsonb). */
export interface PlanOverrides {
  features?: Partial<Record<FeatureKey, boolean>>;
  limits?: Partial<Record<LimitKey, number>>;
}

export interface Entitlements {
  tier: PlanTier;
  features: Set<FeatureKey>;
  /** All limits, resolved. `-1` = unlimited. */
  limits: Record<LimitKey, number>;
}

/**
 * Coerce a possibly-null/unknown plan value plus an optional instance
 * default into a concrete tier. Used by callers before resolveEntitlements.
 */
export function effectiveTier(
  accountPlan: string | null | undefined,
  instanceDefault?: string | null,
): PlanTier {
  if (isPlanTier(accountPlan)) return accountPlan;
  if (isPlanTier(instanceDefault)) return instanceDefault;
  return DEFAULT_TIER;
}

/** Narrow an unknown jsonb value into PlanOverrides (defensive). */
export function parseOverrides(value: unknown): PlanOverrides {
  if (!value || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  const out: PlanOverrides = {};
  if (v.features && typeof v.features === "object") {
    out.features = v.features as PlanOverrides["features"];
  }
  if (v.limits && typeof v.limits === "object") {
    out.limits = v.limits as PlanOverrides["limits"];
  }
  return out;
}

/**
 * Resolve the effective entitlements for a tier, applying per-account
 * overrides on top as ABSOLUTE values (not deltas).
 */
export function resolveEntitlements(
  tier: PlanTier,
  overrides?: PlanOverrides | null,
): Entitlements {
  const base = PLANS[tier];

  const features = new Set<FeatureKey>();
  for (const [key, on] of Object.entries(base.features) as [FeatureKey, boolean][]) {
    if (on) features.add(key);
  }
  const limits = { ...base.limits };

  if (overrides?.features) {
    for (const [key, on] of Object.entries(overrides.features) as [FeatureKey, boolean][]) {
      if (typeof on !== "boolean") continue;
      if (on) features.add(key);
      else features.delete(key);
    }
  }
  if (overrides?.limits) {
    for (const [key, n] of Object.entries(overrides.limits) as [LimitKey, number][]) {
      if (typeof n === "number" && Number.isFinite(n)) limits[key] = n;
    }
  }

  return { tier, features, limits };
}

export function hasFeature(e: Entitlements, feature: FeatureKey): boolean {
  return e.features.has(feature);
}

/** Resolve a limit; `-1` = unlimited. */
export function limitFor(e: Entitlements, key: LimitKey): number {
  return e.limits[key];
}

export interface LimitCheck {
  allowed: boolean;
  limit: number; // -1 = unlimited
  current: number;
}

/**
 * Whether adding one more of `key` is allowed given the current count.
 * Unlimited (`-1`) is always allowed. Blocks when current >= limit
 * (enforce on CREATE only — never retroactively; a downgraded account
 * keeps existing rows but can't add past the cap).
 */
export function checkLimit(e: Entitlements, key: LimitKey, current: number): LimitCheck {
  const limit = e.limits[key];
  if (limit === -1) return { allowed: true, limit, current };
  return { allowed: current < limit, limit, current };
}
