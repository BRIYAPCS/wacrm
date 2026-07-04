-- ============================================================
-- 050_subscription_tiers.sql — subscription tiers (Basic/Pro/Advanced)
--
-- Adds a per-account plan + override mechanism so one codebase can serve
-- all three tiers (no forks). Tiers gate whole feature modules AND numeric
-- limits; the map itself lives in code (src/lib/plans/catalog.ts) — the DB
-- only stores which tier an account is on and any per-account overrides.
--
-- Design notes:
--   * `plan` is TEXT + CHECK (not a Postgres enum) — matches migration
--     021's reasoning for default_currency: a pricing catalogue changes
--     more than a role hierarchy, and text+CHECK is a one-line diff to
--     evolve vs. `ALTER TYPE` (which can't run in a txn / drop values).
--   * `plan` is NULLABLE and defaults to NULL, meaning "defer to the
--     instance default" (env DEFAULT_PLAN, else 'advanced'). This is what
--     lets ONE resolver serve both deployment models:
--        - shared multi-tenant: every account row has `plan` set;
--        - isolated per-client instance: `plan` left NULL, tier comes
--          from the instance's DEFAULT_PLAN env var.
--     It also guarantees NO regression: existing accounts resolve to the
--     instance default ('advanced' = everything) until deliberately changed.
--   * stripe_* columns are unused until the optional Stripe module ships;
--     `plan_source` arbitrates manual (superadmin) vs stripe writes.
--   * `platform_admins` identifies the VENDOR (you), distinct from an
--     account `owner` (a tenant role). Locked down like `app_settings`:
--     RLS on, no client policies — seeded via SQL / service role only.
--
-- Idempotent.
-- ============================================================

-- ---- accounts: plan + overrides + stripe linkage -----------
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS plan text,
  ADD COLUMN IF NOT EXISTS plan_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS plan_source text NOT NULL DEFAULT 'manual';

-- Valid tier values (NULL allowed = defer to instance default).
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_plan_check;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_plan_check
  CHECK (plan IS NULL OR plan IN ('basic', 'pro', 'advanced'));

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_plan_source_check;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_plan_source_check
  CHECK (plan_source IN ('manual', 'stripe'));

-- accounts_update RLS (admin+, migration 017) already covers these columns
-- for the tenant's own admins. The superadmin panel writes cross-account
-- via the service role, so no new policy is needed here. Note: a tenant
-- admin can technically self-set `plan` via PostgREST — that's acceptable
-- for now (it's their own billing) and the authoritative gate is the plan
-- the superadmin/Stripe sets; a follow-up can column-restrict if desired.

-- ---- platform_admins: the vendor / superadmin allowlist -----
CREATE TABLE IF NOT EXISTS platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Locked down exactly like app_settings: RLS on, NO client policies. Only
-- the service role (superadmin API routes) and direct SQL can read/write.
-- A leaked anon/authenticated key must never be able to enumerate or add
-- platform admins.
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
