-- ============================================================
-- 057_invite_gate_by_invitation_row.sql — fix invited-user attachment
--
-- Migration 049 gated the "attach to invited account" branch on
-- `NEW.invited_at IS NOT NULL` (only an admin invite could set it). That
-- assumed GoTrue sets `invited_at` in the INSERT — but current GoTrue sets it
-- in a follow-up UPDATE, so this AFTER-INSERT trigger saw NULL and every real
-- invite fell through to the "invite-only" rejection ("Database error saving
-- new user").
--
-- New anchor: a SERVER-created `account_invitations` row (keyed by email +
-- account, RLS-protected so only an admin of that account can create one). This
-- is the trust boundary — forgeable `user_metadata` can no longer attach a
-- signup to someone else's account, and the ROLE is taken from the invitation
-- (not the metadata), so it can't be escalated. The app writes this row BEFORE
-- calling inviteUserByEmail (see the invitations route), so it exists when this
-- trigger runs. The invitation is consumed (accepted) here.
--
-- Idempotent (CREATE OR REPLACE).
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- (1) Invited → attach to the account named by a PENDING invitation for this
  -- email + account. The invitation row (not the user_metadata) is the trust
  -- anchor: a public signUp with a forged `invited_account_id` has no matching
  -- invitation, so it skips this branch and can't join someone else's account.
  -- The assigned role comes from the invitation (never 'owner').
  IF v_invited_account IS NOT NULL THEN
    SELECT ai.role INTO v_invited_role
    FROM public.account_invitations ai
    WHERE lower(ai.email) = lower(NEW.email)
      AND ai.account_id = v_invited_account
      AND ai.accepted_at IS NULL
      AND ai.expires_at > now()
    ORDER BY ai.created_at DESC
    LIMIT 1;

    IF v_invited_role IS NOT NULL THEN
      IF v_invited_role = 'owner' THEN
        v_invited_role := 'admin';
      END IF;

      INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
      VALUES (NEW.id, v_full_name, NEW.email, v_invited_account, v_invited_role);

      -- Consume the invitation so it drops off the "pending" list.
      UPDATE public.account_invitations
        SET accepted_at = now(), accepted_by_user_id = NEW.id
        WHERE lower(email) = lower(NEW.email)
          AND account_id = v_invited_account
          AND accepted_at IS NULL;

      RETURN NEW;
    END IF;
  END IF;

  -- (2) Uninvited. Reject UNLESS sign-up was explicitly re-opened, OR this is
  -- the first user on a fresh deploy (no accounts yet → bootstrap).
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
$function$;
