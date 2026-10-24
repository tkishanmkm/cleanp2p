-- Security fix for P2P trade cancellation.
-- Reproduces the currently installed function's accounting/state behavior while:
--   1) removing user-editable raw_user_meta_data from admin authorization; and
--   2) requiring service_role when there is no authenticated user session.
-- REVIEW GATE: branch-only draft. Do not apply until staged against a populated
-- database with matching schema and the behavioral tests below pass.

BEGIN;

CREATE OR REPLACE FUNCTION public.cancel_p2p_trade(
    p_trade_id uuid,
    p_caller_id uuid DEFAULT NULL::uuid,
    p_reason text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_auth_uid UUID := auth.uid();
    v_effective_caller UUID;
    v_trade RECORD;
    v_seller_bal NUMERIC(36, 18);
    v_seller_escrow NUMERIC(36, 18);
    v_seller_bal_after NUMERIC(36, 18);
    v_seller_escrow_after NUMERIC(36, 18);
    v_total_escrow NUMERIC(36, 18);
    v_is_paid BOOLEAN := FALSE;
    v_is_disputed BOOLEAN := FALSE;
    v_is_admin BOOLEAN := FALSE;
BEGIN
    -- 1. Authentication check. A caller-supplied identity is trusted only
    -- for the service_role path; authenticated users must match auth.uid().
    IF v_auth_uid IS NOT NULL THEN
        IF p_caller_id IS NOT NULL AND p_caller_id <> v_auth_uid THEN
            RAISE EXCEPTION 'Caller ID mismatch: unauthorized impersonation.';
        END IF;
        v_effective_caller := v_auth_uid;
    ELSE
        IF COALESCE(auth.role(), '') <> 'service_role' THEN
            RAISE EXCEPTION 'Authentication required: service role required for trusted caller ID.';
        END IF;
        IF p_caller_id IS NULL THEN
            RAISE EXCEPTION 'Authentication required: trusted caller ID is required.';
        END IF;
        v_effective_caller := p_caller_id;
    END IF;

    -- 2. Lock trade row.
    SELECT * INTO v_trade
    FROM public.trades
    WHERE id = p_trade_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trade % not found', p_trade_id;
    END IF;

    v_total_escrow := v_trade.crypto_amount + COALESCE(v_trade.escrow_fee, 0.0);

    -- 3. Determine payment and dispute status.
    v_is_paid := (v_trade.paid_at IS NOT NULL)
              OR (v_trade.marked_paid_at IS NOT NULL)
              OR (LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) = 'paid')
              OR (LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('paid', 'buyer_marked_paid', 'payment_sent'));

    v_is_disputed := (LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) = 'disputed')
                  OR (LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('disputed', 'dispute'))
                  OR EXISTS (
                      SELECT 1 FROM public.disputes
                      WHERE trade_id = p_trade_id AND LOWER(status::text) = 'open'
                  );

    -- 4. Admin authority must come only from the trusted helper.
    v_is_admin := public.is_admin();

    -- 5. Non-admin security guards.
    IF NOT v_is_admin THEN
        IF (v_effective_caller::TEXT <> v_trade.buyer_id::TEXT)
           AND (v_effective_caller::TEXT <> v_trade.seller_id::TEXT) THEN
            RAISE EXCEPTION 'Unauthorized: only trade participants or an authorized admin can cancel trade %.', p_trade_id;
        END IF;

        IF v_is_disputed THEN
            RAISE EXCEPTION 'Cannot cancel trade % while a dispute is active. Only an authorized admin can resolve a disputed trade.', p_trade_id;
        END IF;

        IF v_is_paid THEN
            RAISE EXCEPTION 'Cannot cancel trade % after payment has been marked or sent. Post-payment trades must be released or resolved via dispute.', p_trade_id;
        END IF;
    END IF;

    -- 6. Terminal state and replay safety.
    IF LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('completed', 'released')
       OR LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) IN ('completed', 'released') THEN
        RAISE EXCEPTION 'Cannot cancel trade % in completed/released state.', p_trade_id;
    END IF;

    IF LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('cancelled', 'expired')
       OR LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) IN ('cancelled', 'expired') THEN
        RETURN jsonb_build_object(
            'success', true,
            'trade_id', p_trade_id,
            'status', v_trade.status,
            'escrow_status', 'CANCELLED',
            'message', 'Already cancelled (idempotent success)'
        );
    END IF;

    -- 7. Lock seller assets and verify escrow amount.
    SELECT balance, in_escrow INTO v_seller_bal, v_seller_escrow
    FROM public.wallet_assets
    WHERE user_id::TEXT = v_trade.seller_id::TEXT
      AND asset_symbol = v_trade.crypto
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Seller wallet_assets record not found for user % and asset %', v_trade.seller_id, v_trade.crypto;
    END IF;

    IF v_seller_escrow < v_total_escrow THEN
        RAISE EXCEPTION 'Insufficient in_escrow balance for seller refund %: required %, found in escrow %',
            v_trade.seller_id, v_total_escrow, v_seller_escrow;
    END IF;

    -- 8. Atomic refund mutation.
    UPDATE public.wallet_assets
    SET balance = balance + v_total_escrow,
        in_escrow = in_escrow - v_total_escrow,
        updated_at = NOW()
    WHERE user_id::TEXT = v_trade.seller_id::TEXT
      AND asset_symbol = v_trade.crypto
      AND in_escrow >= v_total_escrow
    RETURNING balance, in_escrow INTO v_seller_bal_after, v_seller_escrow_after;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fail-closed: could not process cancellation refund on seller wallet_assets for trade %', p_trade_id;
    END IF;

    -- 9. Record the seller refund ledger entry.
    INSERT INTO public.ledger_entries (
        user_id, crypto, asset, amount, type, reference_id,
        balance_after, metadata, status
    ) VALUES (
        v_trade.seller_id::UUID,
        v_trade.crypto,
        v_trade.crypto,
        +v_total_escrow,
        'transfer',
        'trade_can:' || p_trade_id::TEXT,
        v_seller_bal_after,
        jsonb_build_object(
            'action', 'escrow_cancel_refund',
            'trade_id', p_trade_id,
            'refunded_escrow', v_total_escrow,
            'reason', p_reason
        ),
        'completed'
    );

    -- 10. Update trade state.
    UPDATE public.trades
    SET status = 'cancelled',
        escrow_status = 'CANCELLED',
        cancelled_at = NOW(),
        cancellation_reason = COALESCE(p_reason, 'Trade cancelled'),
        updated_at = NOW()
    WHERE id = p_trade_id;

    -- 11. Resolve an active dispute only through trusted admin authorization.
    IF v_is_disputed THEN
        UPDATE public.disputes
        SET status = 'resolved',
            resolution = COALESCE(p_reason, 'Refunded to seller by admin dispute resolution'),
            resolved_by = v_effective_caller,
            resolved_at = NOW(),
            updated_at = NOW()
        WHERE trade_id = p_trade_id AND LOWER(status::text) = 'open';
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'trade_id', p_trade_id,
        'status', 'cancelled',
        'escrow_status', 'CANCELLED'
    );
END;
$function$;

-- Keep client RPC permissions unchanged here; ACL changes are handled separately
-- after caller inventory. Verify critical privilege assumptions before applying.
DO $$
DECLARE
    v_fn regprocedure := 'public.cancel_p2p_trade(uuid,uuid,text)'::regprocedure;
    v_def text;
BEGIN
    SELECT pg_get_functiondef(v_fn) INTO v_def;
    IF position('raw_user_meta_data' in v_def) > 0 THEN
        RAISE EXCEPTION 'Security assertion failed: user-editable metadata remains in admin check';
    END IF;
    IF position('v_is_admin := public.is_admin()' in v_def) = 0 THEN
        RAISE EXCEPTION 'Security assertion failed: trusted admin helper not used';
    END IF;
    IF position('COALESCE(auth.role(), '''') <> ''service_role''' in v_def) = 0 THEN
        RAISE EXCEPTION 'Security assertion failed: service-role gate missing for null auth.uid()';
    END IF;
END;
$$;

COMMIT;
