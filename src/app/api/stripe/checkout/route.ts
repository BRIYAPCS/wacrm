// ============================================================
// POST /api/stripe/checkout  (account owner only)
//
// Starts a Stripe Checkout session to subscribe the caller's account to a
// tier. Optional: inert unless STRIPE_SECRET_KEY is configured (per-instance
// deploys ignore Stripe and set tiers via the superadmin console instead).
//
// Body: { tier: 'basic' | 'pro' | 'advanced' }
// Returns: { url } — redirect the browser here.
// ============================================================

import { NextResponse } from "next/server";
import Stripe from "stripe";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { isPlanTier } from "@/lib/plans/catalog";
import { isStripeEnabled, priceIdForTier } from "@/lib/billing/stripe-plans";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!isStripeEnabled()) {
      return NextResponse.json({ error: "Billing is not configured." }, { status: 400 });
    }
    // Only the account owner manages billing.
    const ctx = await requireRole("owner");

    const body = (await request.json().catch(() => null)) as { tier?: unknown } | null;
    const tier = body?.tier;
    if (!isPlanTier(tier)) {
      return NextResponse.json(
        { error: "'tier' must be 'basic', 'pro', or 'advanced'" },
        { status: 400 },
      );
    }
    const price = priceIdForTier(tier);
    if (!price) {
      return NextResponse.json(
        { error: `No Stripe price configured for the '${tier}' tier.` },
        { status: 400 },
      );
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const origin =
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ??
      new URL(request.url).origin;

    // Reuse an existing Stripe customer for the account if we have one.
    const { data: acct } = await ctx.supabase
      .from("accounts")
      .select("stripe_customer_id")
      .eq("id", ctx.accountId)
      .maybeSingle();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      customer: (acct as { stripe_customer_id?: string | null } | null)?.stripe_customer_id ?? undefined,
      client_reference_id: ctx.accountId,
      subscription_data: { metadata: { account_id: ctx.accountId } },
      metadata: { account_id: ctx.accountId, tier },
      success_url: `${origin}/settings?tab=billing&checkout=success`,
      cancel_url: `${origin}/settings?tab=billing&checkout=cancelled`,
    });

    if (!session.url) {
      return NextResponse.json({ error: "Could not start checkout." }, { status: 502 });
    }
    return NextResponse.json({ url: session.url });
  } catch (err) {
    return toErrorResponse(err);
  }
}
