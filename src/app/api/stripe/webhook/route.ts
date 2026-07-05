// ============================================================
// POST /api/stripe/webhook  (Stripe → us; no user session)
//
// Maps Stripe subscription lifecycle events onto accounts.plan. Optional
// (inert without STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET).
//
// Precedence: we only write when the account isn't manually-managed
// (plan_source != 'manual'), so a Stripe event never silently stomps a
// comp/manual plan the platform owner set in the superadmin console.
//
// Writes use the service role (webhooks have no session). Signature is
// verified against the RAW request body before anything is trusted.
// ============================================================

import { NextResponse } from "next/server";
import Stripe from "stripe";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { tierForPriceId } from "@/lib/billing/stripe-plans";
import { isPlanTier, type PlanTier } from "@/lib/plans/catalog";

export const runtime = "nodejs";

/** Apply a resolved plan to an account unless it's manually-managed. */
async function applyPlan(
  accountId: string,
  plan: PlanTier | null,
  fields: { customerId?: string | null; subscriptionId?: string | null },
) {
  const admin = supabaseAdmin();
  const { data: acct } = await admin
    .from("accounts")
    .select("plan_source")
    .eq("id", accountId)
    .maybeSingle();
  if ((acct as { plan_source?: string } | null)?.plan_source === "manual") {
    console.warn(`[stripe webhook] skipping ${accountId} — plan_source is 'manual'`);
    return;
  }
  await admin
    .from("accounts")
    .update({
      plan,
      plan_source: "stripe",
      ...(fields.customerId !== undefined ? { stripe_customer_id: fields.customerId } : {}),
      ...(fields.subscriptionId !== undefined
        ? { stripe_subscription_id: fields.subscriptionId }
        : {}),
    })
    .eq("id", accountId);
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!secret || !key) {
    return NextResponse.json({ error: "Billing not configured" }, { status: 400 });
  }

  const stripe = new Stripe(key);
  const sig = request.headers.get("stripe-signature");
  const raw = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig ?? "", secret);
  } catch (err) {
    console.error("[stripe webhook] signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        const accountId = s.metadata?.account_id ?? s.client_reference_id ?? null;
        // Our checkout stamps the (validated) tier name into session
        // metadata, so trust it directly.
        const rawTier = s.metadata?.tier;
        const resolvedTier: PlanTier | null = isPlanTier(rawTier) ? rawTier : null;
        if (accountId) {
          await applyPlan(accountId, resolvedTier, {
            customerId: typeof s.customer === "string" ? s.customer : null,
            subscriptionId: typeof s.subscription === "string" ? s.subscription : null,
          });
        }
        break;
      }
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const accountId = sub.metadata?.account_id ?? null;
        const priceId = sub.items.data[0]?.price?.id ?? null;
        const tier = tierForPriceId(priceId);
        // An active/trialing sub grants its tier; anything else clears it
        // (defer to the instance default — e.g. 'basic' on multi-tenant).
        const active = sub.status === "active" || sub.status === "trialing";
        if (accountId) {
          await applyPlan(accountId, active ? tier : null, {
            subscriptionId: sub.id,
          });
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const accountId = sub.metadata?.account_id ?? null;
        if (accountId) {
          await applyPlan(accountId, null, { subscriptionId: null });
        }
        break;
      }
      default:
        break; // ignore other events
    }
  } catch (err) {
    console.error("[stripe webhook] handler error:", err);
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
