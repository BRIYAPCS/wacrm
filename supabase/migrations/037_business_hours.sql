-- ============================================================
-- 037_business_hours.sql — business hours + away auto-reply
--
-- Adds an account business-hours schedule (per-weekday open/close in a
-- configured timezone) and an optional "we're away" auto-reply that the
-- webhook sends to inbound messages received outside those hours. A
-- per-conversation `away_replied_at` throttles it so a customer isn't
-- greeted on every message while you're closed.
--
-- No new RLS: `accounts` already gates updates to admins; the away flag
-- on `conversations` is written by the webhook's service-role client.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS business_hours jsonb NOT NULL DEFAULT
    '{"mon":{"enabled":true,"open":"09:00","close":"17:00"},"tue":{"enabled":true,"open":"09:00","close":"17:00"},"wed":{"enabled":true,"open":"09:00","close":"17:00"},"thu":{"enabled":true,"open":"09:00","close":"17:00"},"fri":{"enabled":true,"open":"09:00","close":"17:00"},"sat":{"enabled":false,"open":"09:00","close":"17:00"},"sun":{"enabled":false,"open":"09:00","close":"17:00"}}'::jsonb,
  ADD COLUMN IF NOT EXISTS away_auto_reply_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS away_message text NOT NULL DEFAULT
    'Thanks for reaching out! We''re currently closed, but we''ll get back to you during our business hours.';

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS away_replied_at timestamptz;
