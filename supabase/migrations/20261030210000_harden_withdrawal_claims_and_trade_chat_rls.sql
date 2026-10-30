-- Paxones critical financial dispatch and trade-chat authorization hardening.
-- Review against the production schema before applying. This file is proposed only.

CREATE OR REPLACE FUNCTION public.claim_pending_withdrawals(p_limit integer DEFAULT 10)
RETURNS SETOF public.onchain_withdrawals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 100';
  END IF;

  -- The queue row is claimable only when its canonical withdrawal is QUEUED.
  -- For withdrawals requiring manual approval, the approval must be recorded
  -- on the on-chain row by approve_withdrawal before dispatch is possible.
  RETURN QUERY
  WITH claimed AS (
    SELECT ow.id
    FROM public.onchain_withdrawals ow
    JOIN public.withdrawals w ON w.id = ow.id
    WHERE ow.status = 'PENDING'
      AND w.status = 'QUEUED'
      AND (
        COALESCE(w.requires_admin_approval, false) = false
        OR (ow.approved_by IS NOT NULL AND ow.approved_at IS NOT NULL)
      )
    ORDER BY ow.created_at ASC
    LIMIT p_limit
    FOR UPDATE OF ow SKIP LOCKED
  )
  UPDATE public.onchain_withdrawals ow
  SET status = 'PROCESSING',
      updated_at = NOW()
  FROM claimed c
  WHERE ow.id = c.id
  RETURNING ow.*;
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_withdrawal(p_withdrawal_id uuid, p_admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_withdrawal public.withdrawals%ROWTYPE;
  v_is_admin boolean := false;
  v_queue_updated integer := 0;
BEGIN
  IF p_withdrawal_id IS NULL OR p_admin_id IS NULL THEN
    RAISE EXCEPTION 'Withdrawal ID and admin ID are required';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.app_admins WHERE user_id = p_admin_id
    UNION
    SELECT 1 FROM public.profiles WHERE id = p_admin_id AND (role = 'admin' OR is_admin = true)
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized: caller is not a platform administrator';
  END IF;

  SELECT * INTO v_withdrawal
  FROM public.withdrawals
  WHERE id = p_withdrawal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal % not found', p_withdrawal_id;
  END IF;

  IF LOWER(v_withdrawal.status) NOT IN ('pending_approval', 'pending') THEN
    RAISE EXCEPTION 'Withdrawal % cannot be approved from status %', p_withdrawal_id, v_withdrawal.status;
  END IF;

  UPDATE public.onchain_withdrawals
  SET status = 'PENDING',
      approved_by = p_admin_id,
      approved_at = NOW(),
      updated_at = NOW()
  WHERE id = p_withdrawal_id;

  GET DIAGNOSTICS v_queue_updated = ROW_COUNT;
  IF v_queue_updated <> 1 THEN
    RAISE EXCEPTION 'On-chain withdrawal queue row missing for %; approval rolled back', p_withdrawal_id;
  END IF;

  UPDATE public.withdrawals
  SET status = 'QUEUED',
      updated_at = NOW()
  WHERE id = p_withdrawal_id;

  INSERT INTO public.admin_audit_logs (
    admin_id, admin_email, action, details, created_at
  ) VALUES (
    p_admin_id,
    'admin_approver@paxones.com',
    'ADMIN_APPROVED_WITHDRAWAL',
    jsonb_build_object(
      'withdrawal_id', p_withdrawal_id,
      'amount', v_withdrawal.amount,
      'asset', COALESCE(v_withdrawal.asset_symbol, v_withdrawal.token_symbol, v_withdrawal.asset_code)
    ),
    NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'withdrawal_id', p_withdrawal_id,
    'status', 'QUEUED',
    'message', 'Withdrawal approved and queued for broadcast'
  );
END;
$function$;

-- Only actual trade participants may insert trade chat messages.
DROP POLICY IF EXISTS "Trade chat participants can send messages" ON public.trade_chat_messages;
CREATE POLICY "Trade chat participants can send messages"
ON public.trade_chat_messages
FOR INSERT TO authenticated
WITH CHECK (
  sender_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.trades t
    WHERE t.id = trade_chat_messages.trade_id
      AND (t.buyer_id = (SELECT auth.uid())::text OR t.seller_id = (SELECT auth.uid())::text)
  )
);

-- Remove the sender-only bypass: attachment sender must be a participant in
-- the trade. Service role remains able to manage records through its bypass.
DROP POLICY IF EXISTS trade_attachments_participant_insert ON public.trade_attachments;
CREATE POLICY trade_attachments_participant_insert
ON public.trade_attachments
FOR INSERT TO authenticated
WITH CHECK (
  sender_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.trades t
    WHERE (t.id::text = trade_attachments.trade_id OR t.trade_id = trade_attachments.trade_id)
      AND (t.buyer_id = (SELECT auth.uid())::text OR t.seller_id = (SELECT auth.uid())::text)
  )
);

-- Reading a user's own message is not sufficient: they must belong to the trade.
DROP POLICY IF EXISTS trade_messages_select_policy ON public.trade_messages;
CREATE POLICY trade_messages_select_policy
ON public.trade_messages
FOR SELECT TO authenticated
USING (
  is_admin()
  OR EXISTS (
    SELECT 1
    FROM public.trades t
    WHERE t.id::text = trade_messages.trade_id
      AND (t.buyer_id = (SELECT auth.uid())::text OR t.seller_id = (SELECT auth.uid())::text)
  )
);
