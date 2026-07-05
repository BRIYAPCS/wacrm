-- ============================================================
-- 053_plan_unlimited.sql — add the 'unlimited' subscription tier
--
-- Widens the accounts.plan CHECK to accept 'unlimited' (the top tier:
-- everything on, all limits uncapped, incl. WhatsApp numbers + contacts).
-- text+CHECK makes this a one-line change (no ALTER TYPE).
--
-- Idempotent.
-- ============================================================

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_plan_check;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_plan_check
  CHECK (plan IS NULL OR plan IN ('basic', 'pro', 'advanced', 'unlimited'));
