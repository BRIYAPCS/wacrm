-- ============================================================
-- 052_whatsapp_twilio.sql — Twilio as a third WhatsApp provider
--
-- Adds the one field Twilio needs beyond what 051 provides. Per-row
-- credential layout by provider:
--   meta   → phone_number_id + access_token (Meta token) + waba_id
--   twilio → provider_account_id (Account SID) + access_token (Auth Token,
--            encrypted) + phone_number (the WhatsApp sender, e.g. +1415…)
--   wsapi  → wsapi_instance_id + access_token (api key, encrypted)
--
-- Idempotent.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS provider_account_id text;

-- Allow 'twilio' alongside the existing providers.
ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_provider_check;
ALTER TABLE whatsapp_config
  ADD CONSTRAINT whatsapp_config_provider_check
  CHECK (provider IN ('meta', 'wsapi', 'twilio'));
