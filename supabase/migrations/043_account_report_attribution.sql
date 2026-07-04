-- ============================================================
-- 043_account_report_attribution.sql
--
-- Reports → Team Performance counts messages by `messages.sender_id`,
-- which is only recorded for agent sends made AFTER that attribution
-- shipped (v0.19.1). Older agent messages have a null sender_id, so a long
-- date range can show per-agent totals that look lower than reality for
-- the pre-attribution days.
--
-- We deliberately do NOT back-fill (historical agent messages can't be
-- reliably told apart from automated AI/away/flow sends, which are also
-- sender_type='agent' with a null sender_id — attributing those to a human
-- would inflate their numbers). Instead the report now returns
-- `agent_attribution_since`: the earliest date any attributed agent
-- message exists for the account, so the UI can honestly label the window
-- the per-agent numbers cover.
--
-- This is a cold-path query (reports are viewed occasionally, not per
-- message), so the extra account-wide min() is fine and needs no new
-- index on the hot messages table.
--
-- Idempotent (CREATE OR REPLACE).
-- ============================================================

CREATE OR REPLACE FUNCTION public.account_report(
  p_account_id uuid,
  p_since timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text;
  v_summary jsonb;
  v_daily jsonb;
  v_agents jsonb;
  v_avg numeric;
  v_attr_since timestamptz;
BEGIN
  IF NOT is_account_member(p_account_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(timezone, 'UTC') INTO v_tz FROM accounts WHERE id = p_account_id;

  -- ---- summary counts ----
  SELECT jsonb_build_object(
    'conversations_started',
      (SELECT count(*) FROM conversations WHERE account_id = p_account_id AND created_at >= p_since),
    'new_contacts',
      (SELECT count(*) FROM contacts WHERE account_id = p_account_id AND created_at >= p_since),
    'messages_in',
      (SELECT count(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.account_id = p_account_id AND m.created_at >= p_since AND m.sender_type = 'customer'),
    'messages_out',
      (SELECT count(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.account_id = p_account_id AND m.created_at >= p_since AND m.sender_type IN ('agent', 'bot'))
  ) INTO v_summary;

  -- ---- average first-response time (seconds) ----
  WITH firsts AS (
    SELECT c.id AS conv_id,
      min(m.created_at) FILTER (WHERE m.sender_type = 'customer') AS first_in,
      min(m.created_at) FILTER (WHERE m.sender_type IN ('agent', 'bot')) AS first_out
    FROM conversations c
    JOIN messages m ON m.conversation_id = c.id
    WHERE c.account_id = p_account_id AND m.created_at >= p_since
    GROUP BY c.id
  )
  SELECT avg(extract(epoch FROM (first_out - first_in)))
  INTO v_avg
  FROM firsts
  WHERE first_in IS NOT NULL AND first_out IS NOT NULL AND first_out > first_in;

  v_summary := v_summary || jsonb_build_object(
    'avg_first_response_seconds', round(COALESCE(v_avg, 0))
  );

  -- ---- daily inbound/outbound, filled across the range (account tz) ----
  WITH days AS (
    SELECT generate_series(
      (p_since AT TIME ZONE v_tz)::date,
      (now() AT TIME ZONE v_tz)::date,
      interval '1 day'
    )::date AS d
  ),
  agg AS (
    SELECT (m.created_at AT TIME ZONE v_tz)::date AS d,
      count(*) FILTER (WHERE m.sender_type = 'customer') AS inbound,
      count(*) FILTER (WHERE m.sender_type IN ('agent', 'bot')) AS outbound
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.account_id = p_account_id AND m.created_at >= p_since
    GROUP BY 1
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'day', to_char(days.d, 'YYYY-MM-DD'),
      'inbound', COALESCE(agg.inbound, 0),
      'outbound', COALESCE(agg.outbound, 0)
    ) ORDER BY days.d
  )
  INTO v_daily
  FROM days
  LEFT JOIN agg ON agg.d = days.d;

  -- ---- per-agent breakdown ----
  WITH am AS (
    SELECT m.sender_id,
      count(*) AS messages_sent,
      count(DISTINCT m.conversation_id) AS conversations
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.account_id = p_account_id
      AND m.created_at >= p_since
      AND m.sender_type = 'agent'
      AND m.sender_id IS NOT NULL
    GROUP BY m.sender_id
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'user_id', p.user_id,
      'name', p.full_name,
      'messages_sent', COALESCE(am.messages_sent, 0),
      'conversations', COALESCE(am.conversations, 0)
    ) ORDER BY COALESCE(am.messages_sent, 0) DESC, p.full_name
  ), '[]'::jsonb)
  INTO v_agents
  FROM profiles p
  LEFT JOIN am ON am.sender_id = p.user_id
  WHERE p.account_id = p_account_id
    AND p.account_role IN ('owner', 'admin', 'agent');

  -- ---- earliest attributed agent message (the per-agent data horizon) ----
  SELECT min(m.created_at)
  INTO v_attr_since
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id
  WHERE c.account_id = p_account_id AND m.sender_id IS NOT NULL;

  RETURN jsonb_build_object(
    'summary', v_summary,
    'daily', COALESCE(v_daily, '[]'::jsonb),
    'agents', v_agents,
    'agent_attribution_since', v_attr_since
  );
END;
$$;

ALTER FUNCTION public.account_report(uuid, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.account_report(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.account_report(uuid, timestamptz) TO authenticated, service_role;
