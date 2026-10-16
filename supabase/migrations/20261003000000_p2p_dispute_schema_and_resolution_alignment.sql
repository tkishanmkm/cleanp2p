-- Migration: 20261003000000_p2p_dispute_schema_and_resolution_alignment.sql
-- Target: Align public.disputes schema and harden raise_trade_dispute / resolve_trade_dispute RPCs
-- Security: Strict winner validation (buyer/seller only), trade disputed-state guard, immutable resolved dispute idempotency, SECURITY DEFINER, search_path = public, pg_temp

-- ----------------------------------------------------------------------------
-- 1. Extend public.disputes Table Schema (Idempotent)
-- ----------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.disputes
  ADD COLUMN IF NOT EXISTS explanation TEXT,
  ADD COLUMN IF NOT EXISTS resolution TEXT,
  ADD COLUMN IF NOT EXISTS resolution_reason TEXT,
  ADD COLUMN IF NOT EXISTS resolution_note TEXT,
  ADD COLUMN IF NOT EXISTS winner_id UUID,
  ADD COLUMN IF NOT EXISTS resolved_by UUID,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_disputes_trade_id ON public.disputes(trade_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON public.disputes(status);
CREATE INDEX IF NOT EXISTS idx_disputes_winner_id ON public.disputes(winner_id);

-- ----------------------------------------------------------------------------
-- 2. Authoritative raise_trade_dispute RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.raise_trade_dispute(
    p_trade_id UUID,
    p_user_id UUID DEFAULT NULL,
    p_reason TEXT DEFAULT 'Dispute opened'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_auth_uid UUID := auth.uid();
    v_caller_id UUID;
    v_trade RECORD;
    v_is_buyer BOOLEAN := FALSE;
    v_is_seller BOOLEAN := FALSE;
    v_is_admin BOOLEAN := FALSE;
    v_dispute_reason TEXT;
    v_dispute_id UUID;
BEGIN
    -- 1. Authentication Check
    IF v_auth_uid IS NOT NULL THEN
        IF p_user_id IS NOT NULL AND p_user_id <> v_auth_uid THEN
            RAISE EXCEPTION 'Caller ID mismatch: unauthorized impersonation.';
        END IF;
        v_caller_id := v_auth_uid;
    ELSE
        IF p_user_id IS NULL THEN
            RAISE EXCEPTION 'Authentication required: neither session token nor trusted caller ID provided.';
        END IF;
        v_caller_id := p_user_id;
    END IF;

    -- Bound and normalize RPC input independently of API-route validation.
    IF p_reason IS NOT NULL AND char_length(p_reason) > 2000 THEN
        RAISE EXCEPTION 'Dispute reason exceeds the 2000 character limit.';
    END IF;

    -- 2. Lock Trade Row FOR UPDATE
    SELECT * INTO v_trade
    FROM public.trades
    WHERE id = p_trade_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trade % not found', p_trade_id;
    END IF;

    -- 3. Authorization Check (Strict ::TEXT comparison for safety)
    v_is_buyer := (v_caller_id::TEXT = v_trade.buyer_id::TEXT);
    v_is_seller := (v_caller_id::TEXT = v_trade.seller_id::TEXT);
    v_is_admin := public.is_admin()
               OR EXISTS (
                   SELECT 1 FROM auth.users
                   WHERE id = v_caller_id
                     AND ((raw_app_meta_data->>'role') = 'admin')
               )
               OR EXISTS (
                   SELECT 1 FROM public.app_admins
                   WHERE user_id = v_caller_id
               );

    IF NOT (v_is_buyer OR v_is_seller OR v_is_admin) THEN
        RAISE EXCEPTION 'Unauthorized: only trade participants or an authorized admin can raise a dispute for trade %.', p_trade_id;
    END IF;

    -- 4. Terminal State Guard (Enum-safe string casting)
    IF LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('completed', 'released') 
       OR LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) IN ('completed', 'released') THEN
        RAISE EXCEPTION 'Cannot open dispute on trade % in completed/released state.', p_trade_id;
    END IF;

    IF LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('cancelled', 'expired') 
       OR LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) IN ('cancelled', 'expired') THEN
        RAISE EXCEPTION 'Cannot open dispute on trade % in terminal % state.', p_trade_id, v_trade.status;
    END IF;

    -- 5. Idempotent Check: Already Disputed
    IF LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('disputed', 'dispute') 
       OR LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) = 'disputed' THEN
        SELECT id INTO v_dispute_id
        FROM public.disputes
        WHERE trade_id = p_trade_id AND LOWER(status::TEXT) = 'open'
        LIMIT 1;

        RETURN jsonb_build_object(
            'success', true,
            'dispute_id', v_dispute_id,
            'trade_id', p_trade_id,
            'status', 'disputed',
            'escrow_status', 'DISPUTED',
            'message', 'Trade is already in dispute (idempotent success)'
        );
    END IF;

    v_dispute_reason := COALESCE(
        NULLIF(
            TRIM(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(p_reason, ''), '[[:cntrl:]]', ' ', 'g'), '[[:space:]]+', ' ', 'g')),
            ''
        ),
        'Dispute raised by participant'
    );

    -- 6. Atomic Mutation: Set Trade to Disputed
    UPDATE public.trades
    SET status = 'disputed',
        escrow_status = 'DISPUTED',
        disputed_at = NOW(),
        dispute_reason = v_dispute_reason,
        disputed_by = v_caller_id,
        updated_at = NOW()
    WHERE id = p_trade_id;

    -- 7. Insert Dispute Record into public.disputes (Schema Aligned)
    INSERT INTO public.disputes (
        trade_id,
        opened_by,
        opened_by_id,
        reason,
        explanation,
        status,
        created_at,
        updated_at
    ) VALUES (
        p_trade_id,
        v_caller_id,
        v_caller_id,
        v_dispute_reason,
        v_dispute_reason,
        'open',
        NOW(),
        NOW()
    )
    RETURNING id INTO v_dispute_id;

    RETURN jsonb_build_object(
        'success', true,
        'dispute_id', v_dispute_id,
        'trade_id', p_trade_id,
        'status', 'disputed',
        'escrow_status', 'DISPUTED',
        'disputed_by', v_caller_id,
        'reason', v_dispute_reason
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Authoritative resolve_trade_dispute RPC (Strict Winner Validation & Idempotent)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_trade_dispute(
    p_dispute_id UUID,
    p_resolution TEXT,
    p_winner_id UUID,
    p_caller_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_auth_uid UUID := auth.uid();
    v_effective_caller UUID;
    v_dispute RECORD;
    v_trade RECORD;
    v_is_admin BOOLEAN := FALSE;
    v_res JSONB;
    v_is_buyer_winner BOOLEAN := FALSE;
    v_is_seller_winner BOOLEAN := FALSE;
BEGIN
    -- 1. Authentication Check
    IF v_auth_uid IS NOT NULL THEN
        IF p_caller_id IS NOT NULL AND p_caller_id <> v_auth_uid THEN
            RAISE EXCEPTION 'Caller ID mismatch: unauthorized impersonation.';
        END IF;
        v_effective_caller := v_auth_uid;
    ELSE
        IF p_caller_id IS NULL THEN
            RAISE EXCEPTION 'Authentication required: neither session token nor trusted caller ID provided.';
        END IF;
        v_effective_caller := p_caller_id;
    END IF;

    -- Bound and normalize resolution input even when the RPC is called outside an API route.
    IF p_resolution IS NULL OR char_length(p_resolution) > 2000 THEN
        RAISE EXCEPTION 'Resolution must be present and no longer than 2000 characters.';
    END IF;

    p_resolution := TRIM(REGEXP_REPLACE(
        REGEXP_REPLACE(p_resolution, '[[:cntrl:]]', ' ', 'g'),
        '[[:space:]]+', ' ', 'g'
    ));
    IF p_resolution = '' THEN
        RAISE EXCEPTION 'Resolution must contain readable text.';
    END IF;

    -- 2. Admin Authorization Check
    v_is_admin := public.is_admin()
               OR EXISTS (
                   SELECT 1 FROM auth.users
                   WHERE id = v_effective_caller
                     AND ((raw_app_meta_data->>'role') = 'admin')
               )
               OR EXISTS (
                   SELECT 1 FROM public.app_admins
                   WHERE user_id = v_effective_caller
               );

    IF NOT v_is_admin THEN
        RAISE EXCEPTION 'Unauthorized: only an authorized administrator can resolve disputes.';
    END IF;

    -- 3. Lock Dispute Record FOR UPDATE
    SELECT * INTO v_dispute
    FROM public.disputes
    WHERE id = p_dispute_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Dispute % not found.', p_dispute_id;
    END IF;

    -- 4. Immutable Resolved Dispute (Idempotency Guard)
    IF LOWER(COALESCE(v_dispute.status::TEXT, '')) = 'resolved' THEN
        RETURN jsonb_build_object(
            'success', true,
            'dispute_id', p_dispute_id,
            'trade_id', v_dispute.trade_id,
            'status', 'resolved',
            'winner_id', v_dispute.winner_id,
            'message', 'Dispute already resolved (idempotent success)'
        );
    END IF;

    -- 5. Verify Open/Pending State
    IF LOWER(COALESCE(v_dispute.status::TEXT, '')) NOT IN ('open', 'pending', 'in_review', 'investigating') THEN
        RAISE EXCEPTION 'Dispute % cannot be resolved from its current status (%).', p_dispute_id, v_dispute.status;
    END IF;

    -- 6. Lock and Validate Associated Trade
    SELECT * INTO v_trade
    FROM public.trades
    WHERE id = v_dispute.trade_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Associated trade % for dispute % not found.', v_dispute.trade_id, p_dispute_id;
    END IF;

    IF v_trade.buyer_id IS NULL OR v_trade.seller_id IS NULL THEN
        RAISE EXCEPTION 'Corrupt trade state: trade % lacks buyer_id or seller_id.', v_trade.id;
    END IF;

    -- 7. Validate Disputed Trade State (Enum-Safe)
    IF NOT (
        LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('disputed', 'dispute')
        OR LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) = 'disputed'
    ) THEN
        RAISE EXCEPTION 'Trade % is not in a disputed state and cannot be resolved.', v_trade.id;
    END IF;

    -- 8. Strict Winner Validation (UUID / TEXT Safe)
    IF p_winner_id IS NULL THEN
        RAISE EXCEPTION 'Winner ID is required to resolve dispute.';
    END IF;

    v_is_buyer_winner := (p_winner_id::TEXT = v_trade.buyer_id::TEXT);
    v_is_seller_winner := (p_winner_id::TEXT = v_trade.seller_id::TEXT);

    IF NOT (v_is_buyer_winner OR v_is_seller_winner) THEN
        RAISE EXCEPTION 'Winner must be either the buyer or seller of this trade.';
    END IF;

    -- 9. Execute Canonical Financial Settlement
    IF v_is_buyer_winner THEN
        v_res := public.release_trade_escrow(v_trade.id, v_effective_caller);
    ELSIF v_is_seller_winner THEN
        v_res := public.cancel_p2p_trade(v_trade.id, v_effective_caller, p_resolution);
    END IF;

    -- 10. Update Dispute Record
    UPDATE public.disputes
    SET status = 'resolved',
        resolution = p_resolution,
        resolution_reason = p_resolution,
        resolution_note = p_resolution,
        winner_id = p_winner_id,
        resolved_by = v_effective_caller,
        resolved_at = NOW(),
        updated_at = NOW()
    WHERE id = p_dispute_id;

    RETURN jsonb_build_object(
        'success', true,
        'dispute_id', p_dispute_id,
        'trade_id', v_trade.id,
        'status', 'resolved',
        'resolution', p_resolution,
        'winner_id', p_winner_id,
        'settlement_result', v_res
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Grants and Permissions Hardening
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.raise_trade_dispute(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.raise_trade_dispute(UUID, UUID, TEXT) TO authenticated, service_role, postgres;

REVOKE ALL ON FUNCTION public.resolve_trade_dispute(UUID, TEXT, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_trade_dispute(UUID, TEXT, UUID, UUID) TO authenticated, service_role, postgres;
