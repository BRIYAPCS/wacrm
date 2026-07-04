-- ============================================================
-- 033_scheduled_messages.sql — send-later (scheduled messages)
--
-- Lets an agent compose a text message now and have it sent at a
-- future time. A scheduled row is drained by GET /api/scheduled-
-- messages/cron (the same pinger that drives automation Wait steps
-- and flow timeouts), which sends via the shared send core and marks
-- the row sent / failed.
--
-- v1 is text-only. `status` carries a `sending` claim state so two
-- overlapping cron ticks can't double-send the same row.
--
-- RLS: any member may read/cancel their account's scheduled messages;
-- agent+ may create (viewers can't send). The cron drains under the
-- service-role client, which bypasses RLS.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS scheduled_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id       uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body             text NOT NULL,
  send_at          timestamptz NOT NULL,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'canceled')),
  -- Set once sent; points at the persisted messages row.
  sent_message_id  uuid REFERENCES messages(id) ON DELETE SET NULL,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- FK-covering indexes (cascade + join hygiene).
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_account_id ON scheduled_messages (account_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_conversation_id ON scheduled_messages (conversation_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_contact_id ON scheduled_messages (contact_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_created_by ON scheduled_messages (created_by);
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_sent_message_id ON scheduled_messages (sent_message_id);
-- The cron drain's hot path: due-and-pending, oldest first.
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_due
  ON scheduled_messages (send_at)
  WHERE status = 'pending';

ALTER TABLE scheduled_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scheduled_messages_select ON scheduled_messages;
CREATE POLICY scheduled_messages_select ON scheduled_messages FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS scheduled_messages_insert ON scheduled_messages;
CREATE POLICY scheduled_messages_insert ON scheduled_messages FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS scheduled_messages_update ON scheduled_messages;
CREATE POLICY scheduled_messages_update ON scheduled_messages FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS scheduled_messages_delete ON scheduled_messages;
CREATE POLICY scheduled_messages_delete ON scheduled_messages FOR DELETE
  USING (is_account_member(account_id, 'agent'));

CREATE OR REPLACE FUNCTION public.update_scheduled_messages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS scheduled_messages_updated_at ON scheduled_messages;
CREATE TRIGGER scheduled_messages_updated_at
  BEFORE UPDATE ON scheduled_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_scheduled_messages_updated_at();
