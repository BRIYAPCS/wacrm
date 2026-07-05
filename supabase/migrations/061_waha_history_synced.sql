-- ============================================================
-- 061 — Track the one-time WAHA history import
--
-- When a WAHA number first reaches WORKING (QR scanned), the webhook auto-runs
-- the history import once and stamps this column, so a later reconnect doesn't
-- re-import everything. The manual "Sync chats" button re-runs on demand
-- regardless (dedup makes re-runs safe). Idempotent.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS history_synced_at timestamptz;
