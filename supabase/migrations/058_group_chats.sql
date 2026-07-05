-- ============================================================
-- 058 — Group chats in the inbox
--
-- A WhatsApp group is modeled as a contact flagged `is_group`, whose `phone`
-- holds the group JID (…@g.us) and `name` the group subject. This lets the
-- existing conversation ↔ contact ↔ message plumbing carry groups unchanged —
-- one conversation per group, replies routed by the group JID.
--
-- Per-message sender attribution (`sender_phone` / `sender_name`) is added so
-- each inbound group bubble can show WHICH participant sent it (a group thread
-- has many senders; a 1:1 thread has one, where these stay NULL).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS is_group boolean NOT NULL DEFAULT false;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS sender_phone text;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS sender_name text;

-- Contact-facing surfaces (contacts list, dedupe, broadcasts) filter on this,
-- so index it alongside the account for cheap `WHERE account_id = ? AND
-- is_group = false` scans.
CREATE INDEX IF NOT EXISTS idx_contacts_account_is_group
  ON contacts(account_id, is_group);
