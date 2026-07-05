-- ============================================================
-- 051_whatsapp_providers.sql — dual WhatsApp provider support
--
-- Until now every whatsapp_config row was a Meta Cloud API number. This
-- lets a row instead be a wsapi.chat (Baileys) instance, so an account can
-- mix Meta numbers and QR-paired wsapi.chat numbers side by side. Each
-- provider stores what it needs in the same table (reused by the existing
-- multi-number resolver, UI, and the tier `whatsapp_numbers` limit):
--
--   provider = 'meta'  → phone_number_id + access_token (Meta token), as before
--   provider = 'wsapi' → wsapi_instance_id + access_token (the WSAPI api key,
--                        encrypted the same way), phone_number = the paired
--                        device number; phone_number_id stays NULL.
--
-- Idempotent.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'meta',
  ADD COLUMN IF NOT EXISTS wsapi_instance_id text,
  -- Display number (E.164-ish). Meta rows can backfill later; wsapi rows
  -- get the paired device number from /session/status.
  ADD COLUMN IF NOT EXISTS phone_number text;

ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_provider_check;
ALTER TABLE whatsapp_config
  ADD CONSTRAINT whatsapp_config_provider_check CHECK (provider IN ('meta', 'wsapi'));

-- wsapi rows have no Meta phone_number_id. Relax NOT NULL (the global
-- UNIQUE(phone_number_id) from migration 013 stays — NULLs are distinct, so
-- many wsapi rows with NULL coexist).
ALTER TABLE whatsapp_config ALTER COLUMN phone_number_id DROP NOT NULL;

-- A wsapi instance maps to at most one config row, instance-wide.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_whatsapp_config_wsapi_instance
  ON whatsapp_config (wsapi_instance_id)
  WHERE wsapi_instance_id IS NOT NULL;

-- Fast webhook lookup: resolve account by the inbound instance id.
CREATE INDEX IF NOT EXISTS idx_whatsapp_config_wsapi_instance_lookup
  ON whatsapp_config (wsapi_instance_id)
  WHERE provider = 'wsapi';
