-- ==============================================================================
-- Supabase Migration: 20260928080000_p2p_trade_flow_and_rls_hardening.sql
-- Description: Targeted security and state-machine hardening for P2P trades.
--              1. Adds canonical mark_p2p_trade_paid atomic RPC with row locking (FOR UPDATE)
--                 and terminal state guards against cancelled, expired, or completed trades.
--              2. Tightens RLS on public.trades to prohibit direct client updates/inserts on
--                 authoritative financial, status, and participant fields (DEF-05).
--              3. Grants appropriate permissions and ensures safe search_path.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Canonical Atomic mark_p2p_trade_paid RPC
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.mark_p2p_trade_paid(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.mark_p2p_trade_paid(UUID, TEXT);
DROP FUNCTION IF EXISTS public.mark_p2p_trade_paid(UUID);

CREATE OR REPLACE FUNCTION public.mark_p2p_trade_paid(
    p_trade_id UUID,
    p_caller_id UUID DEFAULT NULL,
    p_payment_method TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_auth_uid UUID := auth.uid();
    v_effective_caller UUID;
    v_trade RECORD;
    v_is_buyer BOOLEAN := FALSE;
    v_is_admin BOOLEAN := FALSE;
    v_now TIMESTAMPTZ := NOW();
    v_payment_method TEXT;
BEGIN
    -- 1. Authentication Check
    IF v_auth_uid IS NULL AND p_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    v_effective_caller := COALESCE(p_caller_id, v_auth_uid);

    -- 2. Lock Trade Row FOR UPDATE
    SELECT * INTO v_trade
    FROM public.trades
    WHERE id = p_trade_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trade % not found.', p_trade_id;
    END IF;

    -- 3. Authorization Check (Only the buyer or an admin can mark paid)
    v_is_buyer := (v_effective_caller = v_trade.buyer_id);
    v_is_admin := public.is_admin()
               OR EXISTS (
                   SELECT 1 FROM auth.users
                   WHERE id = v_effective_caller
                     AND ((raw_user_meta_data->>'role') = 'admin' OR (raw_app_meta_data->>'role') = 'admin')
               );

    IF NOT (v_is_buyer OR v_is_admin) THEN
        RAISE EXCEPTION 'Unauthorized: only the trade buyer or an authorized admin can mark trade % as paid.', p_trade_id;
    END IF;

    -- 4. Terminal State Guards
    IF LOWER(COALESCE(v_trade.status, '')) IN ('completed', 'released') 
       OR LOWER(COALESCE(v_trade.escrow_status, '')) IN ('completed', 'released') THEN
        RAISE EXCEPTION 'Cannot mark trade % as paid: trade is already completed/released.', p_trade_id;
    END IF;

    IF LOWER(COALESCE(v_trade.status, '')) IN ('cancelled', 'expired') 
       OR LOWER(COALESCE(v_trade.escrow_status, '')) IN ('cancelled', 'expired') THEN
        RAISE EXCEPTION 'Cannot mark trade % as paid: trade is in terminal % state.', p_trade_id, v_trade.status;
    END IF;

    IF LOWER(COALESCE(v_trade.status, '')) IN ('disputed', 'dispute') 
       OR LOWER(COALESCE(v_trade.escrow_status, '')) = 'disputed' THEN
        RAISE EXCEPTION 'Cannot mark trade % as paid while a dispute is active.', p_trade_id;
    END IF;

    -- 5. Idempotent Check: Already Paid
    IF (v_trade.paid_at IS NOT NULL OR v_trade.marked_paid_at IS NOT NULL)
       AND (LOWER(COALESCE(v_trade.status, '')) IN ('paid', 'buyer_marked_paid', 'payment_sent')
            OR LOWER(COALESCE(v_trade.escrow_status, '')) = 'paid') THEN
        RETURN jsonb_build_object(
            'success', true,
            'trade_id', p_trade_id,
            'status', 'paid',
            'escrow_status', 'PAID',
            'paid_at', COALESCE(v_trade.paid_at, v_trade.marked_paid_at),
            'message', 'Trade is already marked as paid (idempotent replay).'
        );
    END IF;

    -- 6. Resolve Payment Method
    v_payment_method := COALESCE(NULLIF(TRIM(p_payment_method), ''), v_trade.payment_method, 'Bank Transfer');

    -- 7. Atomic Mutation: Update Payment State
    UPDATE public.trades
    SET status = 'paid',
        escrow_status = 'PAID',
        paid_at = v_now,
        marked_paid_at = v_now,
        payment_method = v_payment_method,
        updated_at = v_now
    WHERE id = p_trade_id;

    RETURN jsonb_build_object(
        'success', true,
        'trade_id', p_trade_id,
        'status', 'paid',
        'escrow_status', 'PAID',
        'paid_at', v_now,
        'payment_method', v_payment_method
    );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_p2p_trade_paid(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_p2p_trade_paid(UUID, UUID, TEXT) TO authenticated, service_role, postgres;

-- ------------------------------------------------------------------------------
-- 2. Tighten RLS on public.trades (DEF-05)
-- Prohibit arbitrary direct client UPDATE/INSERT of authoritative financial/status fields.
-- All trade creations and state transitions must flow through canonical RPCs or server admin clients.
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "trades_update_policy" ON public.trades;
DROP POLICY IF EXISTS "trades_insert_policy" ON public.trades;
DROP POLICY IF EXISTS "Users can update own trades" ON public.trades;
DROP POLICY IF EXISTS "Users can insert own trades" ON public.trades;

-- Only Admins or Service Role may directly UPDATE trades.
-- Ordinary users MUST use canonical RPCs (initiate_trade_with_escrow, mark_p2p_trade_paid,
-- release_trade_escrow, cancel_p2p_trade, raise_trade_dispute) which are SECURITY DEFINER.
CREATE POLICY "trades_update_policy" ON public.trades
    FOR UPDATE USING (
        public.is_admin()
    ) WITH CHECK (
        public.is_admin()
    );

-- Only Admins or Service Role may directly INSERT trades.
-- Ordinary users MUST use initiate_trade_with_escrow RPC.
CREATE POLICY "trades_insert_policy" ON public.trades
    FOR INSERT WITH CHECK (
        public.is_admin()
    );

COMMIT;
