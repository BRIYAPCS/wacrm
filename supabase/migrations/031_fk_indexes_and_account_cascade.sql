-- ============================================================
-- 031_fk_indexes_and_account_cascade.sql
--
-- Two related hardening changes surfaced by a full audit:
--
--   1. Covering indexes for every foreign-key column that lacked a
--      leading index. Unindexed FKs force a sequential scan on the
--      child table whenever the parent row is deleted or updated,
--      and can escalate to table-level locks during cascades. This
--      matters much more now that (2) enables account-wide cascade
--      deletes: without these indexes, deleting one account would
--      seq-scan ~two-dozen tables.
--
--   2. `accounts.owner_user_id` was `ON DELETE RESTRICT` — the only
--      FK to `auth.users` that didn't cascade or null out. Because
--      the signup trigger makes every user the owner of an account,
--      deleting that auth user (a GDPR "delete my account" request,
--      or an admin action from the Supabase dashboard) was blocked
--      with an opaque error. Switching it to CASCADE makes deleting
--      the owner's auth user tear the whole tenant down cleanly:
--      accounts → (every account_id FK, all already CASCADE) → done.
--      The DELETE /api/account endpoint relies on this.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. Covering indexes for unindexed foreign keys
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_account_invitations_accepted_by_user_id ON account_invitations (accepted_by_user_id);
CREATE INDEX IF NOT EXISTS idx_account_invitations_created_by_user_id ON account_invitations (created_by_user_id);

CREATE INDEX IF NOT EXISTS idx_ai_configs_created_by ON ai_configs (created_by);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_documents_created_by ON ai_knowledge_documents (created_by);

CREATE INDEX IF NOT EXISTS idx_api_keys_created_by ON api_keys (created_by);

CREATE INDEX IF NOT EXISTS idx_automation_logs_contact_id ON automation_logs (contact_id);

CREATE INDEX IF NOT EXISTS idx_automation_pending_executions_automation_id ON automation_pending_executions (automation_id);
CREATE INDEX IF NOT EXISTS idx_automation_pending_executions_contact_id ON automation_pending_executions (contact_id);
CREATE INDEX IF NOT EXISTS idx_automation_pending_executions_log_id ON automation_pending_executions (log_id);
CREATE INDEX IF NOT EXISTS idx_automation_pending_executions_parent_step_id ON automation_pending_executions (parent_step_id);
CREATE INDEX IF NOT EXISTS idx_automation_pending_executions_user_id ON automation_pending_executions (user_id);

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_contact_id ON broadcast_recipients (contact_id);
CREATE INDEX IF NOT EXISTS idx_broadcasts_user_id ON broadcasts (user_id);

CREATE INDEX IF NOT EXISTS idx_contact_custom_values_custom_field_id ON contact_custom_values (custom_field_id);
CREATE INDEX IF NOT EXISTS idx_contact_notes_contact_id ON contact_notes (contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_notes_user_id ON contact_notes (user_id);

CREATE INDEX IF NOT EXISTS idx_custom_fields_user_id ON custom_fields (user_id);

CREATE INDEX IF NOT EXISTS idx_deals_contact_id ON deals (contact_id);
CREATE INDEX IF NOT EXISTS idx_deals_conversation_id ON deals (conversation_id);
CREATE INDEX IF NOT EXISTS idx_deals_user_id ON deals (user_id);

CREATE INDEX IF NOT EXISTS idx_flow_runs_contact_id ON flow_runs (contact_id);
CREATE INDEX IF NOT EXISTS idx_flow_runs_conversation_id ON flow_runs (conversation_id);
CREATE INDEX IF NOT EXISTS idx_flow_runs_last_prompt_message_id ON flow_runs (last_prompt_message_id);
CREATE INDEX IF NOT EXISTS idx_flow_runs_user_id ON flow_runs (user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_account_id ON notifications (account_id);
CREATE INDEX IF NOT EXISTS idx_notifications_actor_user_id ON notifications (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_contact_id ON notifications (contact_id);
CREATE INDEX IF NOT EXISTS idx_notifications_conversation_id ON notifications (conversation_id);

CREATE INDEX IF NOT EXISTS idx_pipelines_user_id ON pipelines (user_id);
CREATE INDEX IF NOT EXISTS idx_tags_user_id ON tags (user_id);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_created_by ON webhook_endpoints (created_by);
CREATE INDEX IF NOT EXISTS idx_whatsapp_config_user_id ON whatsapp_config (user_id);

-- ============================================================
-- 2. accounts.owner_user_id: RESTRICT -> CASCADE
--
-- Drop whatever the existing FK on owner_user_id is named (the
-- default is accounts_owner_user_id_fkey, but resolve it defensively
-- so this doesn't break if the name ever differs), then recreate it
-- with ON DELETE CASCADE. Re-running is safe: it drops the CASCADE
-- version and adds it back identically.
-- ============================================================
DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT c.conname INTO v_conname
  FROM pg_constraint c
  WHERE c.conrelid = 'public.accounts'::regclass
    AND c.contype = 'f'
    AND c.conkey = ARRAY[
      (SELECT attnum FROM pg_attribute
       WHERE attrelid = 'public.accounts'::regclass
         AND attname = 'owner_user_id')
    ];

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.accounts DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_owner_user_id_fkey
  FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
