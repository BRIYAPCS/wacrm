-- ============================================================
-- 044_invite_by_email.sql — email-pinned team invitations (Stage A)
--
-- Moves invitations from "admin copies a link and shares it" to Supabase's
-- native invite-by-email: the admin enters an email + role, Supabase emails
-- that address a set-your-password link, and the new user lands attached to
-- the inviting account with the assigned role (NOT a personal account).
--
-- Two changes:
--   1. account_invitations records the pinned `email` and the pending
--      auth user id, and `token_hash` becomes nullable (email invites don't
--      use our link token).
--   2. handle_new_user gains an "invited" branch: a user created WITH invite
--      metadata (set by admin.inviteUserByEmail's `data`) is attached to the
--      inviting account with the assigned role. Uninvited signup is
--      UNCHANGED here (still gets a personal account) — Stage B is what flips
--      the instance to invite-only.
--
-- Idempotent.
-- ============================================================

-- ---- account_invitations: email-pinned ---------------------
ALTER TABLE account_invitations
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS invited_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Email invites don't carry our own link token — allow it to be null.
ALTER TABLE account_invitations ALTER COLUMN token_hash DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_account_invitations_email
  ON account_invitations (account_id, email)
  WHERE email IS NOT NULL AND accepted_at IS NULL;

-- ---- signup trigger: attach invited users ------------------
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
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  -- Was this user created by an admin invite (admin.inviteUserByEmail)?
  -- The account + role travel in user_metadata → raw_user_meta_data.
  BEGIN
    v_invited_account := NULLIF(NEW.raw_user_meta_data->>'invited_account_id', '')::uuid;
  EXCEPTION WHEN others THEN
    v_invited_account := NULL;
  END;

  IF v_invited_account IS NOT NULL THEN
    -- Attach to the inviting account with the assigned role. Default to
    -- 'agent' and never let an invite mint an 'owner'.
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

  -- Uninvited signup — unchanged for Stage A: a personal account + owner.
  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
