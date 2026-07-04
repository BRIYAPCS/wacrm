-- ============================================================
-- 040_audit_log.sql — account activity audit trail
--
-- Records sensitive, account-administration actions (who did what, when)
-- so owners/admins can review changes: member role changes & removals,
-- invitations, ownership transfers, and WhatsApp number changes.
--
-- Rows are WRITE-ONCE from the server (service-role) only — there is no
-- INSERT/UPDATE/DELETE policy, so even a compromised member session can
-- neither forge nor erase history. Admins+ can READ their account's log.
--
-- `actor_label` is a snapshot of the actor's name/email AT THE TIME of the
-- action, so the trail stays legible even after that member leaves the
-- account (their profile row moves to a personal account).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- The member who performed the action. NULL for system-generated
  -- events. ON DELETE SET NULL so removing an auth user never deletes
  -- history (actor_label preserves who it was).
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Snapshot of the actor's display name / email at action time.
  actor_label TEXT,
  -- Dotted action key, e.g. 'member.role_changed', 'whatsapp_number.added'.
  action TEXT NOT NULL,
  -- Optional target of the action.
  entity_type TEXT,
  entity_id TEXT,
  -- Free-form structured detail (new_role, phone_number_id, email, …).
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hot path: newest-first within an account.
CREATE INDEX IF NOT EXISTS idx_audit_logs_account_created
  ON audit_logs (account_id, created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Read: admins+ of the account. No write policies — inserts come from the
-- server via the service-role client, which bypasses RLS.
DROP POLICY IF EXISTS "Admins can read account audit log" ON audit_logs;
CREATE POLICY "Admins can read account audit log" ON audit_logs
  FOR SELECT
  USING (is_account_member(account_id, 'admin'));
