-- ============================================================
-- 059 — Agent availability (manual status)
--
-- A manual availability status agents set themselves (Available / Away / Busy /
-- Out of office), layered OVER the automatic online/away/offline presence from
-- migration 024. When an agent sets Away or Out-of-office they show grayed-out
-- (not newly assignable) in the "Assign to" list, and a banner surfaces in the
-- thread. Optional note + an auto-expiry ("back on") timestamp.
--
-- Self-service: the existing "Users can update own profile" RLS policy already
-- lets an agent write these on their own row. Idempotent.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS availability text NOT NULL DEFAULT 'available'
  CHECK (availability IN ('available', 'away', 'busy', 'out_of_office'));

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS availability_note text;

-- When set and in the past, the status auto-reverts to Available (derived
-- client-side — no cron needed).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS availability_until timestamptz;
