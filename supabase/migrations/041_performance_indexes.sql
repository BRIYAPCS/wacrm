-- ============================================================
-- 041_performance_indexes.sql — composite indexes for the two hottest
-- read paths in the app.
--
-- Both the inbox conversation list and the message thread filter by one
-- column and ORDER BY another, but only had a single-column index on the
-- filter — so Postgres did an index scan for the filter and then a
-- separate in-memory Sort for the ordering. These composite indexes let
-- one index satisfy BOTH the filter and the ordering, removing the Sort
-- node entirely (verified with EXPLAIN: the `Sort` step disappears).
--
--   1. Inbox list:   conversations WHERE account_id = ? ORDER BY
--                    last_message_at DESC   (every inbox open)
--   2. Thread:       messages WHERE conversation_id = ? ORDER BY
--                    created_at             (every thread open)
--
-- The messages index also speeds the reports aggregation
-- (account_report), which joins messages by conversation_id and filters
-- on created_at.
--
-- Purely additive — no data change, safe to run multiple times. On a
-- large existing table CREATE INDEX briefly locks writes; self-hosters
-- with very large tables who need zero-downtime can instead run the
-- equivalent CREATE INDEX CONCURRENTLY by hand (it can't run inside a
-- migration transaction).
-- ============================================================

-- Inbox conversation list: filter by account, ordered newest-activity
-- first. DESC matches the query's `ORDER BY last_message_at DESC`
-- (NULLS FIRST on both sides), so the index supplies the order directly.
CREATE INDEX IF NOT EXISTS idx_conversations_account_last_message
  ON conversations (account_id, last_message_at DESC);

-- Message thread: all messages in a conversation, oldest first.
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON messages (conversation_id, created_at);
