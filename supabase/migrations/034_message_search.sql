-- ============================================================
-- 034_message_search.sql — full-text search over message content
--
-- Adds a generated `fts` tsvector on messages (language-neutral
-- `simple` config, matching the AI knowledge base) plus a GIN index,
-- so the inbox search box can find conversations by what was actually
-- said, not just by contact name. Search runs under the caller's RLS
-- client, so tenancy is enforced by the existing messages policies —
-- no new grants.
--
-- Note: adding a STORED generated column backfills every existing
-- message row once (a table rewrite). Fine at self-host scale; runs
-- inside the migration.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content_text, ''))) STORED;

CREATE INDEX IF NOT EXISTS idx_messages_fts ON messages USING gin (fts);
