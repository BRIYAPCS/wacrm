-- ============================================================
-- 056_plan_limit_triggers.sql — enforce per-plan CREATE limits for the
-- client-insert paths (dashboard "Add contact" / "New pipeline"), which have
-- no server route to gate.
--
-- Exempts the service-role / inbound path (auth.uid() IS NULL) so:
--   • a customer messaging in is NEVER dropped by a contact cap, and
--   • the public API (service-role) is gated in its route layer instead.
-- Enforces on CREATE only (count >= limit) — a downgraded account keeps its
-- existing rows, it just can't add past the cap. Mirrors the numeric limits in
-- src/lib/plans/catalog.ts — KEEP IN SYNC when repackaging tiers (they change
-- rarely). `-1` = unlimited.
--
-- Idempotent.
-- ============================================================

-- Resolve an account's tier for SQL-side checks. The instance default
-- (NEXT_PUBLIC_DEFAULT_PLAN) lives in env, which SQL can't read, so a NULL
-- accounts.plan falls back to 'unlimited' here (fail-open — consistent with
-- the tier philosophy: a missing plan never blocks, RLS still isolates
-- tenants). Multi-tenant deploys set accounts.plan per account, which is
-- honored exactly.
CREATE OR REPLACE FUNCTION account_plan_tier(p_account_id uuid)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT a.plan FROM accounts a WHERE a.id = p_account_id),
    'unlimited'
  );
$$;

-- Resolve a numeric limit for (account, key): per-account override wins, else
-- the catalog value for the tier. Only the keys enforced here are defined.
CREATE OR REPLACE FUNCTION account_plan_limit(p_account_id uuid, p_key text)
RETURNS integer LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_tier text := account_plan_tier(p_account_id);
  v_override integer;
BEGIN
  SELECT (o.plan_overrides->'limits'->>p_key)::int INTO v_override
    FROM accounts o WHERE o.id = p_account_id;
  IF v_override IS NOT NULL THEN RETURN v_override; END IF;

  RETURN CASE p_key
    WHEN 'contacts' THEN CASE v_tier
      WHEN 'basic' THEN 1000 WHEN 'pro' THEN 25000
      WHEN 'advanced' THEN 100000 ELSE -1 END
    WHEN 'pipelines' THEN CASE v_tier
      WHEN 'basic' THEN 1 WHEN 'pro' THEN 10 ELSE -1 END
    ELSE -1
  END;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_contacts_limit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_limit integer; v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;      -- inbound / service-role
  v_limit := account_plan_limit(NEW.account_id, 'contacts');
  IF v_limit < 0 THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_count FROM contacts WHERE account_id = NEW.account_id;
  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'You have reached your plan limit of % contacts. Upgrade to add more.', v_limit
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_pipelines_limit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_limit integer; v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  v_limit := account_plan_limit(NEW.account_id, 'pipelines');
  IF v_limit < 0 THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_count FROM pipelines WHERE account_id = NEW.account_id;
  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'You have reached your plan limit of % pipeline(s). Upgrade to add more.', v_limit
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_contacts_limit ON contacts;
CREATE TRIGGER trg_enforce_contacts_limit
  BEFORE INSERT ON contacts
  FOR EACH ROW EXECUTE FUNCTION enforce_contacts_limit();

DROP TRIGGER IF EXISTS trg_enforce_pipelines_limit ON pipelines;
CREATE TRIGGER trg_enforce_pipelines_limit
  BEFORE INSERT ON pipelines
  FOR EACH ROW EXECUTE FUNCTION enforce_pipelines_limit();
