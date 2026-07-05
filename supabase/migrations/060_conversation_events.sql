-- ============================================================
-- 060 — Conversation events (inline action history)
--
-- Assignment / transfer / status-change entries shown between messages in a
-- thread, so a conversation handled by several agents carries its own history
-- ("Ana transferred this to Beto", "Beto marked this closed"). Not WhatsApp
-- messages — a separate, lightweight audit stream merged into the timeline
-- client-side by created_at.
-- ============================================================

CREATE TABLE IF NOT EXISTS conversation_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_type text NOT NULL
    CHECK (event_type IN ('assigned', 'unassigned', 'status_changed')),
  -- The agent who performed the action (auth user id).
  actor_id uuid,
  -- { to_agent_id, from_agent_id, to_status }
  meta jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversation_events_conv
  ON conversation_events (conversation_id, created_at);

ALTER TABLE conversation_events ENABLE ROW LEVEL SECURITY;

-- Account members read the history; agent+ members can write it (mirrors the
-- conversations write policy). is_account_member from 017_account_sharing.sql.
DROP POLICY IF EXISTS "members read conversation events" ON conversation_events;
CREATE POLICY "members read conversation events" ON conversation_events
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS "agents write conversation events" ON conversation_events;
CREATE POLICY "agents write conversation events" ON conversation_events
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
