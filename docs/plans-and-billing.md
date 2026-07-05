# Plans & billing (subscription tiers)

Offer the CRM in **Basic / Pro / Advanced** tiers from **one codebase** —
no forks. A per-account "entitlements" layer gates whole feature modules
and numeric limits; you (the vendor) set each client's tier from a hidden
superadmin console, and Stripe can optionally drive it automatically.

**Migration required:** `supabase/migrations/050_subscription_tiers.sql`.

---

## How a tier is decided

Each account resolves to a tier via this precedence (highest first):

1. **`accounts.plan_overrides`** — per-account add-ons you toggle (per key).
2. **`accounts.plan`** — the account's tier (set manually or by Stripe).
3. **`NEXT_PUBLIC_DEFAULT_PLAN`** — the instance default (env).
4. **`advanced`** — final fallback (full access).

This one chain serves both deployment models:

- **Isolated instance per client** — leave `accounts.plan` NULL and set
  `NEXT_PUBLIC_DEFAULT_PLAN` to the tier that client bought. One knob.
- **Shared multi-tenant** — set each account's `plan` (via the console or
  Stripe); set `NEXT_PUBLIC_DEFAULT_PLAN=basic` so a new/cancelled account
  lands on the entry tier.

After migration 050, every existing account has `plan = NULL` and the
default is `advanced`, so **nothing changes** until you deliberately
downgrade an account.

---

## What the tiers include

The matrix lives in **one file** — `src/lib/plans/catalog.ts` (`PLANS`).
Edit it to re-package the tiers; nothing else changes. Defaults:

| | Basic | Pro | Advanced |
|---|---|---|---|
| AI assistant + knowledge base | – | ✓ | ✓ |
| Automations | – | ✓ | ✓ |
| Flows (visual builder) | – | – | ✓ |
| Broadcasts | ✓ | ✓ | ✓ |
| Multiple WhatsApp numbers | 1 | 3 | ∞ |
| Public REST API | – | – | ✓ |
| Audit log | – | – | ✓ |
| Team seats | 2 | 10 | ∞ |
| Contacts | 1,000 | 25,000 | ∞ |

Enforcement is **server-side and authoritative** (the plan is re-resolved
on every request); the UI gates (locked nav rows, upgrade screens) are
cosmetic. A gated request returns `403` with `code: "plan_upgrade_required"`.

---

## Setting a client's tier — the superadmin console

You're the **platform admin** (distinct from an account `owner`). Become
one either way:

- Set `PLATFORM_ADMIN_EMAILS=you@example.com` (comma-separated), **or**
- `INSERT INTO platform_admins (user_id) VALUES ('<your-auth-uid>');`

Then visit **`/superadmin`** (it 404s for everyone else). There you can:

- **Set each account's plan** — Basic / Pro / Advanced / instance-default.
- **Force-on per-account add-ons** — e.g. give one Basic client AI without
  moving them to Pro. (Writes `accounts.plan_overrides`.)

Setting a plan here marks it **manual** (`plan_source = 'manual'`), so a
later Stripe event won't overwrite a comp/manual plan. Every change is
written to the audit log.

---

## Optional: automated billing with Stripe

Only needed for the **shared multi-tenant** model; per-instance deploys
ignore Stripe and set tiers in the console. Everything is inert unless
`STRIPE_SECRET_KEY` is set.

1. Create three recurring **Prices** in Stripe (one per tier) and set:
   ```
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_PRICE_BASIC=price_...
   STRIPE_PRICE_PRO=price_...
   STRIPE_PRICE_ADVANCED=price_...
   NEXT_PUBLIC_STRIPE_ENABLED=true
   ```
2. Add a webhook endpoint in Stripe pointing at
   **`https://your-domain/api/stripe/webhook`**, subscribe to
   `checkout.session.completed` and `customer.subscription.updated|deleted`,
   and set `STRIPE_WEBHOOK_SECRET=whsec_...`.
3. Owners see self-serve **upgrade buttons** in Settings → Plan & billing,
   which open Stripe Checkout (`POST /api/stripe/checkout`).

The webhook maps `price → tier` onto `accounts.plan` (via the service
role, after verifying the signature) and sets `plan_source = 'stripe'`. It
**skips** any account you've set to `manual` in the console. On
cancellation the account reverts to `NEXT_PUBLIC_DEFAULT_PLAN` — set that
to `basic` on a multi-tenant deploy.

---

## Downgrades

Limits are enforced **on create/add only** — never retroactively. A client
downgraded from 10 seats to 2 keeps their existing members but can't invite
a new one until they're back under the cap. No data is ever deleted.

---

## Where it lives (for developers)

- `src/lib/plans/catalog.ts` — the tier matrix (features + limits).
- `src/lib/plans/entitlements.ts` — resolver + override merge.
- `src/lib/auth/account.ts` — `requireFeature` / `requireWithinLimit` guards.
- `src/lib/auth/api-context.ts` — the same gate for the public API.
- `src/lib/auth/platform.ts` — `requirePlatformAdmin` (the console).
- `src/lib/billing/stripe-plans.ts` + `src/app/api/stripe/*` — Stripe.
