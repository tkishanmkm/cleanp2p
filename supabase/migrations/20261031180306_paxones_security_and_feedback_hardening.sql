BEGIN;

-- Pin the two remaining caller-facing SECURITY DEFINER helpers. Their bodies
-- use schema-qualified references, so an empty path is safe and deterministic.
ALTER FUNCTION public.is_admin() SET search_path = '';
ALTER FUNCTION public.get_my_kyc_info() SET search_path = '';

-- Neither ad table may accept a SELL listing while inventory is not reserved
-- atomically. Remove every existing INSERT policy first because permissive
-- policies are OR-combined by PostgreSQL.
DO $$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ads' AND cmd IN ('INSERT', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.ads', v_policy.policyname);
  END LOOP;

  FOR v_policy IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'p2p_ads' AND cmd IN ('INSERT', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.p2p_ads', v_policy.policyname);
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS paxones_authenticated_buy_ads_only ON public.ads;
CREATE POLICY paxones_authenticated_buy_ads_only
ON public.ads
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND upper(coalesce(type::text, '')) <> 'SELL'
  AND upper(coalesce(trade_type, '')) <> 'SELL'
);

DROP POLICY IF EXISTS paxones_authenticated_buy_p2p_ads_only ON public.p2p_ads;
CREATE POLICY paxones_authenticated_buy_p2p_ads_only
ON public.p2p_ads
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND upper(coalesce(ad_type::text, '')) <> 'SELL'
  AND upper(coalesce(type::text, '')) <> 'SELL'
);

REVOKE INSERT ON TABLE public.ads, public.p2p_ads FROM PUBLIC, anon;
GRANT INSERT ON TABLE public.ads, public.p2p_ads TO authenticated, service_role;

-- trade_chat_messages is a compatibility/moderator stream. Its current client
-- INSERT rule checked only sender_id and did not prove trade participation.
-- Moderator writes already go through the verified server API/service role.
DO $$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trade_chat_messages' AND cmd IN ('INSERT', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.trade_chat_messages', v_policy.policyname);
  END LOOP;
END;
$$;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.trade_chat_messages FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.trade_chat_messages TO service_role;

DROP POLICY IF EXISTS paxones_admin_read_trade_chat_messages ON public.trade_chat_messages;
CREATE POLICY paxones_admin_read_trade_chat_messages
ON public.trade_chat_messages
FOR SELECT
TO authenticated
USING (public.is_admin());

-- Review rows use public.feedbacks. Permit a review only from a completed
-- trade participant to the opposite participant. Reviews are unique per
-- trade and reviewer so both parties may review independently.
DO $$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'feedbacks'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.feedbacks', v_policy.policyname);
  END LOOP;
END;
$$;

ALTER TABLE public.feedbacks DROP CONSTRAINT IF EXISTS feedbacks_trade_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS feedbacks_trade_reviewer_unique
  ON public.feedbacks (trade_id, reviewer_id);

REVOKE INSERT, UPDATE, DELETE ON TABLE public.feedbacks FROM PUBLIC, anon;
REVOKE UPDATE, DELETE ON TABLE public.feedbacks FROM authenticated;
GRANT INSERT ON TABLE public.feedbacks TO authenticated, service_role;

CREATE POLICY paxones_completed_trade_counterparty_feedback_insert
ON public.feedbacks
FOR INSERT
TO authenticated
WITH CHECK (
  reviewer_id = (SELECT auth.uid())
  AND reviewee_id IS NOT NULL
  AND reviewer_id IS DISTINCT FROM reviewee_id
  AND EXISTS (
    SELECT 1
    FROM public.trades AS t
    WHERE t.id = feedbacks.trade_id
      AND (
        lower(coalesce(t.status::text, '')) IN ('completed', 'released')
        OR upper(coalesce(t.escrow_status::text, '')) IN ('COMPLETED', 'RELEASED')
        OR t.completed_at IS NOT NULL
        OR t.released_at IS NOT NULL
      )
      AND (
        (
          t.buyer_id::uuid = (SELECT auth.uid())
          AND t.seller_id::uuid = feedbacks.reviewee_id
        )
        OR
        (
          t.seller_id::uuid = (SELECT auth.uid())
          AND t.buyer_id::uuid = feedbacks.reviewee_id
        )
      )
  )
);

-- Legacy reputation rows are written only by the server-mediated feedback
-- endpoint. This prevents direct PostgREST inserts/edits from forging public
-- reputation and lets sync_user_reputation derive counts from trusted rows.
DO $$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'feedback'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.feedback', v_policy.policyname);
  END LOOP;
END;
$$;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.feedback FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.feedback TO service_role;

-- user_feedbacks has no active application caller and its old ALL policy let
-- either reviewer or recipient mutate reputation. Keep it server-only until
-- a supported flow is implemented.
DO $$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_feedbacks'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.user_feedbacks', v_policy.policyname);
  END LOOP;
END;
$$;
REVOKE ALL PRIVILEGES ON TABLE public.user_feedbacks FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.user_feedbacks TO service_role;

COMMIT;
