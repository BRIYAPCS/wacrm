import { describe, it, expect } from "vitest";
import {
  PLANS,
  PLAN_TIERS,
  isPlanTier,
  planRank,
  DEFAULT_TIER,
  type FeatureKey,
  type LimitKey,
} from "./catalog";
import {
  resolveEntitlements,
  effectiveTier,
  parseOverrides,
  checkLimit,
  hasFeature,
} from "./entitlements";

const ALL_FEATURES: FeatureKey[] = [
  "ai",
  "flows",
  "automations",
  "public_api",
  "multi_number",
  "broadcasts",
  "audit_log",
  "reports",
];
const ALL_LIMITS: LimitKey[] = [
  "seats",
  "whatsapp_numbers",
  "contacts",
  "api_keys",
  "kb_documents",
  "kb_bytes",
  "broadcast_recipients",
  "pipelines",
];

describe("catalog completeness", () => {
  it("every tier defines every feature and every limit", () => {
    for (const tier of PLAN_TIERS) {
      for (const f of ALL_FEATURES) {
        expect(typeof PLANS[tier].features[f]).toBe("boolean");
      }
      for (const l of ALL_LIMITS) {
        expect(typeof PLANS[tier].limits[l]).toBe("number");
      }
    }
  });

  it("tiers are monotonically ranked and advanced is the default", () => {
    expect(planRank("basic")).toBeLessThan(planRank("pro"));
    expect(planRank("pro")).toBeLessThan(planRank("advanced"));
    expect(DEFAULT_TIER).toBe("advanced");
  });
});

describe("effectiveTier", () => {
  it("uses a valid account plan", () => {
    expect(effectiveTier("basic")).toBe("basic");
  });
  it("falls back to the instance default when the account plan is null", () => {
    expect(effectiveTier(null, "pro")).toBe("pro");
    expect(effectiveTier("", "pro")).toBe("pro");
  });
  it("falls back to advanced for unknown values (fail-open)", () => {
    expect(effectiveTier(null, null)).toBe("advanced");
    expect(effectiveTier("garbage", "also-bad")).toBe("advanced");
  });
});

describe("resolveEntitlements", () => {
  it("basic excludes AI/flows/public_api", () => {
    const e = resolveEntitlements("basic");
    expect(hasFeature(e, "ai")).toBe(false);
    expect(hasFeature(e, "flows")).toBe(false);
    expect(hasFeature(e, "public_api")).toBe(false);
    expect(hasFeature(e, "broadcasts")).toBe(true);
  });

  it("advanced includes everything and is mostly unlimited", () => {
    const e = resolveEntitlements("advanced");
    for (const f of ALL_FEATURES) expect(hasFeature(e, f)).toBe(true);
    expect(e.limits.seats).toBe(-1);
    expect(e.limits.contacts).toBe(-1);
  });

  it("applies feature overrides on top of the base tier (add-on)", () => {
    const e = resolveEntitlements("basic", { features: { ai: true } });
    expect(hasFeature(e, "ai")).toBe(true);
    // untouched features stay as the base tier
    expect(hasFeature(e, "flows")).toBe(false);
  });

  it("applies feature overrides that DISABLE a base feature", () => {
    const e = resolveEntitlements("pro", { features: { ai: false } });
    expect(hasFeature(e, "ai")).toBe(false);
  });

  it("applies absolute limit overrides", () => {
    const e = resolveEntitlements("basic", { limits: { seats: 25 } });
    expect(e.limits.seats).toBe(25);
    // untouched limits stay as base
    expect(e.limits.whatsapp_numbers).toBe(PLANS.basic.limits.whatsapp_numbers);
  });

  it("ignores malformed override values", () => {
    const e = resolveEntitlements("basic", {
      // @ts-expect-error deliberately malformed
      features: { ai: "yes" },
      // @ts-expect-error deliberately malformed
      limits: { seats: "lots" },
    });
    expect(hasFeature(e, "ai")).toBe(false);
    expect(e.limits.seats).toBe(PLANS.basic.limits.seats);
  });
});

describe("checkLimit", () => {
  it("blocks at the cap, allows below it", () => {
    const e = resolveEntitlements("basic"); // seats: 2
    expect(checkLimit(e, "seats", 1).allowed).toBe(true);
    expect(checkLimit(e, "seats", 2).allowed).toBe(false);
    expect(checkLimit(e, "seats", 3).allowed).toBe(false); // over-cap (downgrade) stays blocked
  });
  it("always allows when unlimited", () => {
    const e = resolveEntitlements("advanced"); // seats: -1
    expect(checkLimit(e, "seats", 9_999).allowed).toBe(true);
  });
});

describe("parseOverrides", () => {
  it("returns {} for non-objects", () => {
    expect(parseOverrides(null)).toEqual({});
    expect(parseOverrides("x")).toEqual({});
  });
  it("passes through features/limits objects", () => {
    expect(parseOverrides({ features: { ai: true }, limits: { seats: 5 } })).toEqual({
      features: { ai: true },
      limits: { seats: 5 },
    });
  });
});

describe("isPlanTier", () => {
  it("accepts valid tiers, rejects junk", () => {
    expect(isPlanTier("pro")).toBe(true);
    expect(isPlanTier("enterprise")).toBe(false);
    expect(isPlanTier(null)).toBe(false);
  });
});
