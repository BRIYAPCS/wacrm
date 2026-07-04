-- ============================================================
-- 045_invite_only.sql — lock the instance to invite-only (Stage B)
--
-- After this, a random email can no longer self-register. New users get in
-- only two ways:
--   1. They were invited (admin.inviteUserByEmail — the Stage A path); OR
--   2. They are the VERY FIRST user on a fresh deploy (no accounts exist
--      yet), who bootstraps the workspace as owner.
-- Everyone else's sign-up is rejected at the database level, so it holds
-- even against a direct API call, not just the hidden /signup form.
--
-- No-lockout guarantees:
--   * Invited users always attach (never blocked).
--   * The first-user bootstrap always works on an empty instance.
--   * `app_settings.public_signup_enabled` is a one-line escape hatch to
--     temporarily re-open open sign-up:
--        UPDATE app_settings SET public_signup_enabled = true;
--
-- Idempotent.
-- ============================================================

-- ---- instance settings (single row) ------------------------
CREATE TABLE IF NOT EXISTS app_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- false = invite-only (the default). true re-opens public sign-up.
  public_signup_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Locked down: only the SECURITY DEFINER trigger (owner postgres, bypasses
-- RLS) and the service role read/write it. No client policies.
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- ---- signup trigger: enforce invite-only -------------------
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
  -- the assigned role (never owner). Always allowed.
  IF v_invited_account IS NOT NULL THEN
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
  -- This RAISE is deliberately OUTSIDE any exception handler so it actually
  -- rolls back the auth.users insert and fails the sign-up.
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
