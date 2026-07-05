-- ============================================================
-- 054_contact_profile.sql — richer WhatsApp contact profiles
--
-- `contacts.avatar_url` already exists (rendered in the contact sidebar).
-- This adds the rest of what a WhatsApp profile can carry and a staleness
-- marker so we only re-fetch periodically:
--   about              — the contact's WhatsApp "about"/status text
--   profile_fetched_at — when we last pulled their profile from the provider
--
-- Only the wsapi.chat provider can supply a photo/about (it links a real
-- WhatsApp session); Meta/Twilio give only the display name (already stored
-- as `contacts.name`).
--
-- Idempotent.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS about text,
  ADD COLUMN IF NOT EXISTS profile_fetched_at timestamptz;
