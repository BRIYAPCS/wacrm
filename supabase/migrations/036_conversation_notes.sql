-- ============================================================
-- 036_conversation_notes.sql — internal notes + @mentions
--
-- Team-only notes attached to a conversation (never sent to the
-- customer). A note can @mention teammates; mentioned members get a
-- `mention` notification via a SECURITY DEFINER trigger (notifications
-- have no client INSERT policy, matching the assignment trigger).
--
-- RLS: any member may read; agent+ may add (viewers are read-only).
-- Notes are immutable (no update/delete policy) — an audit trail.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS conversation_notes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id     uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  author_user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body                text NOT NULL,
  -- User ids @mentioned in the body; drives the mention notifications.
  mentioned_user_ids  uuid[] NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversation_notes_account_id ON conversation_notes (account_id);
CREATE INDEX IF NOT EXISTS idx_conversation_notes_conversation_id ON conversation_notes (conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_notes_author ON conversation_notes (author_user_id);

ALTER TABLE conversation_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_notes_select ON conversation_notes;
CREATE POLICY conversation_notes_select ON conversation_notes FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS conversation_notes_insert ON conversation_notes;
CREATE POLICY conversation_notes_insert ON conversation_notes FOR INSERT
  WITH CHECK (
    is_account_member(account_id, 'agent') AND author_user_id = auth.uid()
  );

-- ============================================================
-- Allow the new `mention` notification type.
-- ============================================================
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'mention'));

-- ============================================================
-- Trigger — notify @mentioned members on a new note.
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_note_mentions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_contact_id uuid;
  v_contact_name text;
  v_author_name text;
BEGIN
  IF array_length(NEW.mentioned_user_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT conv.contact_id, COALESCE(NULLIF(c.name, ''), c.phone)
    INTO v_contact_id, v_contact_name
  FROM conversations conv
  LEFT JOIN contacts c ON c.id = conv.contact_id
  WHERE conv.id = NEW.conversation_id;

  SELECT full_name INTO v_author_name
  FROM profiles WHERE user_id = NEW.author_user_id;

  FOREACH v_uid IN ARRAY NEW.mentioned_user_ids LOOP
    CONTINUE WHEN v_uid = NEW.author_user_id; -- don't notify yourself
    -- Only notify genuine members of this account.
    IF EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = v_uid AND p.account_id = NEW.account_id
    ) THEN
      INSERT INTO notifications (
        account_id, user_id, type, conversation_id, contact_id,
        actor_user_id, title, body
      ) VALUES (
        NEW.account_id, v_uid, 'mention', NEW.conversation_id, v_contact_id,
        NEW.author_user_id,
        COALESCE(v_author_name, 'Someone') || ' mentioned you',
        'On ' || COALESCE(v_contact_name, 'a conversation') || ': ' || left(NEW.body, 140)
      );
    END IF;
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'note mention notify failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.notify_note_mentions() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_note_mentions ON conversation_notes;
CREATE TRIGGER on_note_mentions
  AFTER INSERT ON conversation_notes
  FOR EACH ROW EXECUTE FUNCTION public.notify_note_mentions();

-- ============================================================
-- Realtime — so notes appear live in the thread for teammates.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'conversation_notes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE conversation_notes;
  END IF;
END $$;
