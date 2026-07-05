// ============================================================
// Stripe ↔ plan-tier mapping (optional module).
//
// Stripe is entirely optional: everything here is inert unless
// STRIPE_SECRET_KEY is set. The price catalogue lives in env so Stripe's
// product IDs never leak into the core PLANS map:
//   STRIPE_PRICE_BASIC, STRIPE_PRICE_PRO, STRIPE_PRICE_ADVANCED
// ============================================================

import type { PlanTier } from "@/lib/plans/catalog";

/** True when Stripe billing is configured for this deployment. */
export function isStripeEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

/** tier → configured Stripe price id (or undefined if unset). */
export function priceIdForTier(tier: PlanTier): string | undefined {
  switch (tier) {
    case "basic":
      return process.env.STRIPE_PRICE_BASIC || undefined;
    case "pro":
      return process.env.STRIPE_PRICE_PRO || undefined;
    case "advanced":
      return process.env.STRIPE_PRICE_ADVANCED || undefined;
  }
}

/** Reverse lookup: a Stripe price id → the tier it grants (or null). */
export function tierForPriceId(priceId: string | null | undefined): PlanTier | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_BASIC) return "basic";
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro";
  if (priceId === process.env.STRIPE_PRICE_ADVANCED) return "advanced";
  return null;
}
