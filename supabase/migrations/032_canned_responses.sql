-- ============================================================
-- 032_canned_responses.sql — saved replies (canned responses)
--
-- Account-shared message snippets an agent inserts into the inbox
-- composer via a `/shortcut` or the saved-replies picker. The body
-- may contain merge fields ({{contact.name}}, {{agent.name}}, …) that
-- are substituted client-side at insert time — the stored content is
-- the raw template.
--
-- RLS mirrors settings-class data: any member may read/use; agent+ may
-- create / edit / delete (viewers are read-only across the app).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS canned_responses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- The token typed after `/` in the composer, e.g. "hours" → /hours.
  shortcut    text NOT NULL,
  -- Human-friendly name shown in the picker.
  title       text NOT NULL,
  -- Message body; may contain {{merge.fields}} resolved at insert time.
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canned_responses_account_id
  ON canned_responses (account_id);
CREATE INDEX IF NOT EXISTS idx_canned_responses_created_by
  ON canned_responses (created_by);

-- One shortcut per account, case-insensitive (so /Hours and /hours can't
-- both exist and confuse the picker). A partial/functional UNIQUE needs
-- an index, not a table constraint.
CREATE UNIQUE INDEX IF NOT EXISTS canned_responses_account_shortcut_key
  ON canned_responses (account_id, lower(shortcut));

ALTER TABLE canned_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS canned_responses_select ON canned_responses;
CREATE POLICY canned_responses_select ON canned_responses FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS canned_responses_insert ON canned_responses;
CREATE POLICY canned_responses_insert ON canned_responses FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS canned_responses_update ON canned_responses;
CREATE POLICY canned_responses_update ON canned_responses FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS canned_responses_delete ON canned_responses;
CREATE POLICY canned_responses_delete ON canned_responses FOR DELETE
  USING (is_account_member(account_id, 'agent'));

CREATE OR REPLACE FUNCTION public.update_canned_responses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS canned_responses_updated_at ON canned_responses;
CREATE TRIGGER canned_responses_updated_at
  BEFORE UPDATE ON canned_responses
  FOR EACH ROW
  EXECUTE FUNCTION public.update_canned_responses_updated_at();
