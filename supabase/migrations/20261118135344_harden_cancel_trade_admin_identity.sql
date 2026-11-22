-- Wayones: remove user-editable metadata from the authenticated trade-cancellation admin path.
BEGIN;

CREATE OR REPLACE FUNCTION public.cancel_p2p_trade(
    p_trade_id UUID,
    p_caller_id UUID DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
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

    -- 2. Lock Trade Row FOR UPDATE
    SELECT * INTO v_trade
    FROM public.trades
    WHERE id = p_trade_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trade % not found', p_trade_id;
    END IF;

    v_total_escrow := v_trade.crypto_amount + COALESCE(v_trade.escrow_fee, 0.0);

    -- 3. Determine Payment and Dispute Status (ENUM safe)
    v_is_paid := (v_trade.paid_at IS NOT NULL)
              OR (v_trade.marked_paid_at IS NOT NULL)
              OR (LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) = 'paid')
              OR (LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('paid', 'buyer_marked_paid', 'payment_sent'));

    v_is_disputed := (LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) = 'disputed')
                  OR (LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('disputed', 'dispute'))
                  OR EXISTS (SELECT 1 FROM public.disputes WHERE trade_id = p_trade_id AND LOWER(status::text) = 'open');

    -- 4. Check Admin Privileges
    -- Admin identity comes only from an active database profile or active full-admin membership.
    -- Never trust user-editable user_metadata or stale JWT role claims.
    v_is_admin := v_effective_caller IS NOT NULL AND (
        EXISTS (
            SELECT 1
            FROM public.profiles AS p
            WHERE p.id = v_effective_caller
              AND COALESCE(p.is_banned, FALSE) = FALSE
              AND COALESCE(p.is_restricted, FALSE) = FALSE
              AND COALESCE(p.is_suspended, FALSE) = FALSE
              AND COALESCE(p.is_on_hold, FALSE) = FALSE
              AND LOWER(COALESCE(NULLIF(p.account_status, ''), NULLIF(p.status, ''), 'active')) NOT IN
                  ('banned', 'restricted', 'suspended', 'on_hold', 'hold', 'frozen', 'disabled', 'closed', 'deleted', 'deletion_pending')
              AND (p.role = 'admin' OR p.is_admin IS TRUE OR p.is_admin_account IS TRUE)
        )
        OR EXISTS (
            SELECT 1
            FROM public.app_admins AS a
            JOIN public.profiles AS p ON p.id = a.user_id
            WHERE a.user_id = v_effective_caller
              AND a.role IN ('admin', 'superadmin')
              AND COALESCE(p.is_banned, FALSE) = FALSE
              AND COALESCE(p.is_restricted, FALSE) = FALSE
              AND COALESCE(p.is_suspended, FALSE) = FALSE
              AND COALESCE(p.is_on_hold, FALSE) = FALSE
              AND LOWER(COALESCE(NULLIF(p.account_status, ''), NULLIF(p.status, ''), 'active')) NOT IN
                  ('banned', 'restricted', 'suspended', 'on_hold', 'hold', 'frozen', 'disabled', 'closed', 'deleted', 'deletion_pending')
        )
    );
    -- Browser sessions may cancel only as ordinary participants. Admin overrides require a
    -- server-role call after verifyServerAdmin has validated the signed 2FA context.
    IF v_is_admin AND auth.role() IS DISTINCT FROM 'service_role' THEN
        v_is_admin := FALSE;
    END IF;

    -- 5. Non-Admin Security Guards: Strict Cancellation Prohibitions
    IF NOT v_is_admin THEN
        IF (v_effective_caller::TEXT <> v_trade.buyer_id::TEXT) AND (v_effective_caller::TEXT <> v_trade.seller_id::TEXT) THEN
            RAISE EXCEPTION 'Unauthorized: only trade participants or an authorized admin can cancel trade %.', p_trade_id;
        END IF;

        IF v_is_disputed THEN
            RAISE EXCEPTION 'Cannot cancel trade % while a dispute is active. Only an authorized admin can resolve a disputed trade.', p_trade_id;
        END IF;

        IF v_is_paid THEN
            RAISE EXCEPTION 'Cannot cancel trade % after payment has been marked or sent. Post-payment trades must be released or resolved via dispute.', p_trade_id;
        END IF;
    END IF;

    -- 6. Terminal State & Replay Safety (ENUM safe)
    IF LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('completed', 'released') OR LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) IN ('completed', 'released') THEN
        RAISE EXCEPTION 'Cannot cancel trade % in completed/released state.', p_trade_id;
    END IF;

    IF LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('cancelled', 'expired') OR LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) IN ('cancelled', 'expired') THEN
        RETURN jsonb_build_object(
            'success', true,
            'trade_id', p_trade_id,
            'status', v_trade.status,
            'escrow_status', 'CANCELLED',
            'message', 'Already cancelled (idempotent success)'
        );
    END IF;

    -- 7. Lock Seller Assets FOR UPDATE (Defensive ::TEXT casting)
    SELECT balance, in_escrow INTO v_seller_bal, v_seller_escrow
    FROM public.wallet_assets
    WHERE user_id::TEXT = v_trade.seller_id::TEXT AND asset_symbol = v_trade.crypto
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Seller wallet_assets record not found for user % and asset %', v_trade.seller_id, v_trade.crypto;
    END IF;

    IF v_seller_escrow < v_total_escrow THEN
        RAISE EXCEPTION 'Insufficient in_escrow balance for seller refund %: required %, found in escrow %',
            v_trade.seller_id, v_total_escrow, v_seller_escrow;
    END IF;

    -- 8. Atomic Refund Mutations on wallet_assets
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

    -- 9. Record Seller Cancellation Ledger Entry
    INSERT INTO public.ledger_entries (
        user_id,
        crypto,
        asset,
        amount,
        type,
        reference_id,
        balance_after,
        metadata,
        status
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

    -- 10. Update Trade State to Cancelled
    UPDATE public.trades
    SET status = 'cancelled',
        escrow_status = 'CANCELLED',
        cancelled_at = NOW(),
        cancellation_reason = COALESCE(p_reason, 'Trade cancelled'),
        updated_at = NOW()
    WHERE id = p_trade_id;

    -- 11. Resolve Active Dispute if present (Cast enum status to text for LOWER())
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
$$;
ALTER FUNCTION public.cancel_p2p_trade(UUID, UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.cancel_p2p_trade(UUID, UUID, TEXT) SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION public.cancel_p2p_trade(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_p2p_trade(UUID, UUID, TEXT) TO authenticated, service_role, postgres;

COMMIT;