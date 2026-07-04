-- ============================================================
-- 048_chat_backgrounds.sql
--
-- Owner/admin-configurable chat backgrounds (WhatsApp-style
-- wallpapers) at two scopes:
--
--   1. Account default  → accounts.inbox_background
--   2. Per-conversation → conversations.background
--
-- Both hold a small, app-validated token string (never raw CSS):
--   NULL / ''        → inherit (conversation → account → built-in doodle)
--   'doodle'|'plain'|<preset key>
--   'color:#rrggbb'  → custom solid colour
--   'image:account-<account_id>/<file>'  → uploaded wallpaper
--
-- The token is validated in the app (src/lib/inbox/backgrounds.ts) on
-- both write paths; storing it as plain text keeps the DB dumb and the
-- render layer the single source of truth for how a token becomes CSS.
--
-- A new `chat-backgrounds` Storage bucket holds uploaded wallpapers.
-- Unlike `chat-media` (any member can attach), wallpaper WRITES are
-- restricted to owners/admins — changing the team's chat backdrop is an
-- admin act. Reads are public (the bucket is public so the <div> can
-- reference the URL without a signed request).
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ============================================================
-- 1. Columns
-- ============================================================
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS inbox_background text;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS background text;

-- ============================================================
-- 2. chat-backgrounds storage bucket
--
-- Images only, 5 MB cap (wallpapers don't need to be large, and the
-- ceiling bounds abuse). Path convention matches the other account-
-- scoped buckets (016/020/023):
--   chat-backgrounds/account-<account_id>/<timestamp>-<basename>.<ext>
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-backgrounds',
  'chat-backgrounds',
  TRUE,
  5242880, -- 5 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================
-- 3. Storage RLS — public reads, owner/admin account-scoped writes
--
-- Same account-scoped path predicate as migration 023, tightened with a
-- role check so only owners/admins can upload/replace/remove a
-- wallpaper. Drop-then-create (no CREATE POLICY IF NOT EXISTS).
-- ============================================================
DROP POLICY IF EXISTS "Chat backgrounds are publicly readable" ON storage.objects;
CREATE POLICY "Chat backgrounds are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'chat-backgrounds');

DROP POLICY IF EXISTS "Admins can upload chat backgrounds" ON storage.objects;
CREATE POLICY "Admins can upload chat backgrounds"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'chat-backgrounds'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Admins can update chat backgrounds" ON storage.objects;
CREATE POLICY "Admins can update chat backgrounds"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'chat-backgrounds'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Admins can delete chat backgrounds" ON storage.objects;
CREATE POLICY "Admins can delete chat backgrounds"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'chat-backgrounds'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );
