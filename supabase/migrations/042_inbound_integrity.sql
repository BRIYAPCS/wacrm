-- ============================================================
-- 042_inbound_integrity.sql — stop duplicate threads & double-processed
-- inbound messages.
--
-- Two latent integrity gaps the inbound path could hit:
--
--   1. conversations had NO unique key on (account_id, contact_id) — only
--      plain indexes. The "one thread per contact" rule was enforced only
--      by application find-or-create. A race (Meta redelivery / two rapid
--      inbounds) or a contact merge could create a 2nd conversation for a
--      contact; after that, the find-or-create `.single()` throws on every
--      future inbound (>=2 rows), so a BRAND-NEW thread was created for
--      every incoming message — permanent inbox fragmentation.
--
--   2. messages had NO unique key on (conversation_id, message_id). Meta
--      delivers webhooks at-least-once, so a redelivered inbound inserted a
--      duplicate bubble, double-incremented unread_count, and re-fired
--      automations / AI auto-reply (customer double-texted).
--
-- This migration collapses any existing duplicates, then adds the unique
-- indexes so the app layer's ON CONFLICT / unique-violation handling
-- (added alongside this migration) makes both paths idempotent.
--
-- Idempotent and safe to run multiple times. On DBs with no duplicates
-- (the common case) the dedup blocks are no-ops.
-- ============================================================

-- ---- PART A: collapse duplicate conversations -------------------------
-- Survivor = the earliest conversation per (account_id, contact_id). All
-- child rows are re-pointed to it, then the losers are deleted.
DO $$
DECLARE
  dupmap CONSTANT text := $q$
    SELECT c.id AS loser, s.survivor
    FROM conversations c
    JOIN (
      SELECT account_id, contact_id,
             (array_agg(id ORDER BY created_at, id))[1] AS survivor
      FROM conversations
      GROUP BY account_id, contact_id
      HAVING count(*) > 1
    ) s ON c.account_id = s.account_id AND c.contact_id = s.contact_id
    WHERE c.id <> s.survivor
  $q$;
  child text;
BEGIN
  -- Re-point every table that references conversations.id.
  FOREACH child IN ARRAY ARRAY[
    'messages', 'conversation_notes', 'deals', 'flow_runs',
    'message_reactions', 'notifications', 'scheduled_messages'
  ] LOOP
    EXECUTE format(
      'UPDATE %I ch SET conversation_id = m.survivor FROM (%s) m WHERE ch.conversation_id = m.loser',
      child, dupmap
    );
  END LOOP;

  -- Fold losers' unread counts into the survivor before deleting them.
  EXECUTE format($f$
    UPDATE conversations sv
    SET unread_count = sv.unread_count + agg.extra
    FROM (
      SELECT survivor, sum(l.unread_count) AS extra
      FROM (%s) m
      JOIN conversations l ON l.id = m.loser
      GROUP BY survivor
    ) agg
    WHERE sv.id = agg.survivor
  $f$, dupmap);

  -- Delete the now-empty duplicate conversations.
  EXECUTE format('DELETE FROM conversations WHERE id IN (SELECT loser FROM (%s) m)', dupmap);
END $$;

-- Refresh survivors' last-message snapshot from their (now merged) messages
-- so the inbox list shows the correct latest activity. Cheap and correct
-- even when nothing merged (it just re-affirms existing values).
UPDATE conversations c
SET last_message_at = lm.max_at,
    last_message_text = lm.text
FROM (
  SELECT DISTINCT ON (m.conversation_id)
    m.conversation_id,
    max(m.created_at) OVER (PARTITION BY m.conversation_id) AS max_at,
    m.content_text AS text
  FROM messages m
  ORDER BY m.conversation_id, m.created_at DESC
) lm
WHERE c.id = lm.conversation_id
  AND (c.last_message_at IS DISTINCT FROM lm.max_at);

-- Enforce one conversation per (account, contact) going forward.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_conversation_account_contact
  ON conversations (account_id, contact_id);

-- ---- PART B: collapse duplicate messages ------------------------------
-- Keep the earliest row per (conversation_id, message_id); re-point child
-- references off the losers, then delete them. Only real Meta ids are
-- deduped (skip null/empty, which predate a wamid).
DO $$
DECLARE
  dupmap CONSTANT text := $q$
    SELECT r.id AS loser, r.keeper
    FROM (
      SELECT id,
        first_value(id) OVER w AS keeper,
        row_number()      OVER w AS rn
      FROM messages
      WHERE message_id IS NOT NULL AND message_id <> ''
      WINDOW w AS (PARTITION BY conversation_id, message_id ORDER BY created_at, id)
    ) r
    WHERE r.rn > 1
  $q$;
BEGIN
  -- Re-point swipe-reply references off the losers.
  EXECUTE format(
    'UPDATE messages m SET reply_to_message_id = d.keeper FROM (%s) d WHERE m.reply_to_message_id = d.loser',
    dupmap
  );

  -- Drop reactions that would collide with the keeper on its unique
  -- (message_id, actor_type, actor_id), then move the rest to the keeper.
  EXECUTE format($f$
    DELETE FROM message_reactions r
    USING (%s) d, message_reactions k
    WHERE r.message_id = d.loser
      AND k.message_id = d.keeper
      AND k.actor_type = r.actor_type
      AND k.actor_id   = r.actor_id
  $f$, dupmap);
  EXECUTE format(
    'UPDATE message_reactions r SET message_id = d.keeper FROM (%s) d WHERE r.message_id = d.loser',
    dupmap
  );

  -- Delete the duplicate message rows.
  EXECUTE format('DELETE FROM messages WHERE id IN (SELECT loser FROM (%s) d)', dupmap);
END $$;

-- Enforce inbound/outbound idempotency per conversation going forward.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_message_conversation_wamid
  ON messages (conversation_id, message_id)
  WHERE message_id IS NOT NULL AND message_id <> '';
