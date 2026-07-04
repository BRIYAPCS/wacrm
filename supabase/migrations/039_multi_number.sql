-- ============================================================
-- 039_multi_number.sql — support multiple WhatsApp numbers per account
--
-- Until now `whatsapp_config` carried UNIQUE(account_id): exactly one
-- WhatsApp number per account. This migration relaxes that so an account
-- can connect several numbers (e.g. Sales + Support), while keeping the
-- global UNIQUE(phone_number_id) from migration 013 (a number still maps
-- to at most one account instance-wide).
--
-- Threading model: ONE conversation per contact (unchanged). A
-- conversation records WHICH of the account's numbers it is currently on
-- via `conversations.whatsapp_config_id`; inbound updates it to the number
-- that received the message, and replies go out from that number. So a
-- contact who messages two of your numbers stays a single merged thread
-- whose "current number" follows their most recent inbound.
--
-- Exactly one number per account is the DEFAULT (`is_default`) — used for
-- outbound where no conversation number is known (public-API sends,
-- broadcasts, template/media/react operations).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ---- new columns on whatsapp_config -------------------------
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

-- Drop the one-number-per-account constraint (added in 017). Keep the
-- global UNIQUE(phone_number_id) from 013 untouched.
ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;

-- A number can only be added once to a given account.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_config_account_phone_key'
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_account_phone_key
      UNIQUE (account_id, phone_number_id);
  END IF;
END $$;

-- At most one default number per account.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_default_config_per_account
  ON whatsapp_config (account_id)
  WHERE is_default;

-- ---- single-default invariant (trigger) ---------------------
-- When a row is inserted/updated as the default, demote every other row
-- in the same account. The demotion UPDATE sets is_default=false, so the
-- trigger's WHEN(NEW.is_default) guard is false for those rows — no
-- recursion. This keeps the invariant regardless of which caller sets it.
CREATE OR REPLACE FUNCTION public.enforce_single_default_config()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE whatsapp_config
  SET is_default = false
  WHERE account_id = NEW.account_id
    AND id <> NEW.id
    AND is_default;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_single_default_config ON whatsapp_config;
CREATE TRIGGER trg_enforce_single_default_config
  BEFORE INSERT OR UPDATE OF is_default ON whatsapp_config
  FOR EACH ROW
  WHEN (NEW.is_default)
  EXECUTE FUNCTION public.enforce_single_default_config();

-- ---- conversations: which number the thread is on ----------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID REFERENCES whatsapp_config(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_whatsapp_config
  ON conversations (whatsapp_config_id);

-- ---- backfill existing single-number accounts ---------------
-- Every account currently has exactly one config (old UNIQUE): make it the
-- default and give it a label so the UI has something to show.
UPDATE whatsapp_config SET is_default = true
  WHERE is_default = false
    AND account_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM whatsapp_config o
      WHERE o.account_id = whatsapp_config.account_id AND o.is_default
    );

UPDATE whatsapp_config SET label = 'Primary'
  WHERE label IS NULL OR label = '';

-- Point existing conversations at their account's (sole) number.
UPDATE conversations c
SET whatsapp_config_id = wc.id
FROM whatsapp_config wc
WHERE wc.account_id = c.account_id
  AND wc.is_default
  AND c.whatsapp_config_id IS NULL;
