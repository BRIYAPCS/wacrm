-- ============================================================
-- 055_whatsapp_waha.sql — WAHA (self-hosted) as a WhatsApp provider
--
-- WAHA (https://waha.devlike.pro) is a self-hosted WhatsApp HTTP API. Like
-- wsapi.chat it pairs by QR from the customer's own phone, but the gateway
-- runs on OUR infrastructure (a Docker container we operate). It is exposed
-- to tenants provider-blind, exactly like the other providers.
--
-- Each WAHA number maps to one WAHA "session". We store:
--   waha_session — the session name on the WAHA server (webhook lookup key)
--   base_url     — the WAHA server this number lives on (nullable → env
--                  WAHA_BASE_URL default; lets a future 2nd server coexist)
-- The API key stays in `access_token` (encrypted), like every provider.
--
-- Idempotent.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS waha_session text,
  ADD COLUMN IF NOT EXISTS base_url text;

-- Widen the provider CHECK to include 'waha'.
ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_provider_check;
ALTER TABLE whatsapp_config
  ADD CONSTRAINT whatsapp_config_provider_check
  CHECK (provider IN ('meta', 'wsapi', 'twilio', 'waha'));

-- One row per WAHA session (mirrors the wsapi_instance_id unique index).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_whatsapp_config_waha_session
  ON whatsapp_config (waha_session)
  WHERE waha_session IS NOT NULL;

-- Fast webhook resolution: provider='waha' AND waha_session = <session>.
CREATE INDEX IF NOT EXISTS idx_whatsapp_config_waha_session_lookup
  ON whatsapp_config (waha_session)
  WHERE provider = 'waha';
