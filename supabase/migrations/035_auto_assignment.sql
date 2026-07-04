-- ============================================================
-- 035_auto_assignment.sql — round-robin auto-assignment
--
-- When enabled, a brand-new inbound conversation is auto-assigned to
-- the next agent in rotation. Config lives on `accounts`
-- (`auto_assign_enabled` + a `auto_assign_cursor` round-robin pointer);
-- membership in the rotation is a per-profile `assignable` flag
-- (default true for agent+).
--
-- The pick is an atomic SECURITY DEFINER RPC that locks the account row
-- (`FOR UPDATE`) so two concurrent inbound webhooks can't hand the same
-- slot to two agents. It's granted to service_role only — the webhook
-- calls it under the admin client.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS auto_assign_enabled boolean NOT NULL DEFAULT false,
  -- Last-assigned agent; the rotation pointer. Nullable / may dangle if
  -- that agent later leaves — the RPC tolerates a missing cursor.
  ADD COLUMN IF NOT EXISTS auto_assign_cursor uuid;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS assignable boolean NOT NULL DEFAULT true;

-- Pick + advance the round-robin cursor for an account, returning the
-- chosen agent's user_id (or NULL when no assignable agents exist).
CREATE OR REPLACE FUNCTION public.assign_next_agent(p_account_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cursor uuid;
  v_next uuid;
BEGIN
  -- Serialize picks for this account so concurrent inbound webhooks
  -- advance the cursor one at a time (no double-assign).
  SELECT auto_assign_cursor INTO v_cursor
  FROM accounts WHERE id = p_account_id FOR UPDATE;

  WITH agents AS (
    SELECT user_id,
           row_number() OVER (ORDER BY user_id) AS rn,
           count(*) OVER () AS total
    FROM profiles
    WHERE account_id = p_account_id
      AND assignable = true
      AND account_role IN ('owner', 'admin', 'agent')
  ),
  pick AS (
    SELECT
      total,
      COALESCE((SELECT rn FROM agents WHERE user_id = v_cursor), 0) AS cursor_rn
    FROM agents
    LIMIT 1
  )
  SELECT a.user_id INTO v_next
  FROM agents a, pick
  WHERE a.rn = (pick.cursor_rn % pick.total) + 1;

  IF v_next IS NULL THEN
    RETURN NULL; -- no assignable agents in the rotation
  END IF;

  UPDATE accounts SET auto_assign_cursor = v_next WHERE id = p_account_id;
  RETURN v_next;
END;
$$;

ALTER FUNCTION public.assign_next_agent(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.assign_next_agent(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_next_agent(uuid) TO service_role;
