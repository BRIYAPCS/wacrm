-- ============================================================
-- 049_security_hardening.sql
--
-- Three security/correctness fixes surfaced by a full-app audit:
--
--  1. CRITICAL — signup trigger trusted client-controlled metadata.
--     handle_new_user() attached a new user to `invited_account_id` /
--     `invited_account_role` taken straight from raw_user_meta_data, with
--     no proof an invite existed. Because `supabase.auth.signUp({ options:
--     { data } })` lets ANY anon caller set that metadata, anyone could
--     self-register as admin of any account (cross-tenant takeover).
--
--     Fix: only honor the invite metadata when `auth.users.invited_at`
--     is set — which ONLY a service-role `admin.inviteUserByEmail` call
--     can do (the account_invitations row is written after the trigger
--     fires, so it can't be checked here). A forged self-signup has a
--     null invited_at and now falls through to the invite-only gate.
--
--  2. HIGH — record_webhook_failure() was EXECUTE-able by PUBLIC.
--     A SECURITY DEFINER function keyed only by endpoint_id, with no
--     membership check and no REVOKE, let any anon caller disable any
--     account's outbound webhooks. Locked to service_role.
--
--  3. MEDIUM — claim_ai_reply_slot() had the same world-executable defect
--     (any caller could exhaust an account's AI auto-reply budget on a
--     chosen conversation). Locked to service_role.
--
-- Plus a correctness fix:
--
--  4. Atomic inbound conversation bump. The webhook did a read-modify-
--     write on unread_count (read N, write N+1), so two concurrent inbound
--     POSTs for one contact lost an increment. A single-statement RPC does
--     the increment under the row lock.
--
-- Idempotent.
-- ============================================================

-- ============================================================
-- 1. Harden the signup trigger (keep 045's invite-only behavior, add the
--    invited_at gate on the invited branch).
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
  v_invited_account UUID;
  v_invited_role account_role_enum;
  v_open BOOLEAN;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  BEGIN
    v_invited_account := NULLIF(NEW.raw_user_meta_data->>'invited_account_id', '')::uuid;
  EXCEPTION WHEN others THEN
    v_invited_account := NULL;
  END;

  -- (1) Invited via admin.inviteUserByEmail → attach to that account with
  -- the assigned role (never owner). Gated on `invited_at`, which ONLY a
  -- service-role admin invite can set — a public signUp with forged
  -- `invited_account_id` metadata has a null invited_at and skips this
  -- branch entirely, so it can't attach to someone else's account.
  IF NEW.invited_at IS NOT NULL AND v_invited_account IS NOT NULL THEN
    BEGIN
      v_invited_role := COALESCE(
        NULLIF(NEW.raw_user_meta_data->>'invited_account_role', '')::account_role_enum,
        'agent'
      );
    EXCEPTION WHEN others THEN
      v_invited_role := 'agent';
    END;
    IF v_invited_role = 'owner' THEN
      v_invited_role := 'admin';
    END IF;

    INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
    VALUES (NEW.id, v_full_name, NEW.email, v_invited_account, v_invited_role);
    RETURN NEW;
  END IF;

  -- (2) Uninvited. Reject UNLESS sign-up was explicitly re-opened, OR this
  -- is the first user on a fresh deploy (no accounts yet → bootstrap).
  SELECT public_signup_enabled INTO v_open FROM public.app_settings LIMIT 1;
  IF EXISTS (SELECT 1 FROM public.accounts LIMIT 1) AND NOT COALESCE(v_open, false) THEN
    RAISE EXCEPTION 'Sign-up is invite-only on this instance. Ask an admin for an invitation.'
      USING ERRCODE = '42501';
  END IF;

  -- Bootstrap a personal account + owner (first user, or open-signup mode).
  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

-- ============================================================
-- 2 + 3. Lock the two world-executable SECURITY DEFINER RPCs to the
--        service role (both are only ever called server-side).
-- ============================================================
-- NOTE: Supabase grants EXECUTE on public functions directly to `anon`
-- and `authenticated` (not only via PUBLIC), so all three must be revoked
-- explicitly or the RPC stays callable with the anon key.
REVOKE ALL ON FUNCTION public.record_webhook_failure(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_webhook_failure(uuid, int) TO service_role;

REVOKE ALL ON FUNCTION public.claim_ai_reply_slot(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_reply_slot(uuid, integer) TO service_role;

-- ============================================================
-- 4. Atomic inbound conversation bump (fixes the unread_count
--    read-modify-write race in the webhook).
-- ============================================================
CREATE OR REPLACE FUNCTION public.bump_conversation_on_inbound(
  p_conversation_id uuid,
  p_last_text text,
  p_last_at timestamptz
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.conversations
  SET last_message_text = p_last_text,
      last_message_at = p_last_at,
      unread_count = COALESCE(unread_count, 0) + 1,
      updated_at = now()
  WHERE id = p_conversation_id;
$$;

ALTER FUNCTION public.bump_conversation_on_inbound(uuid, text, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.bump_conversation_on_inbound(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_conversation_on_inbound(uuid, text, timestamptz) TO service_role;
