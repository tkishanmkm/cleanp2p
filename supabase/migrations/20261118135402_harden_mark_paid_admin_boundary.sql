-- Wayones: keep normal buyer payment confirmation, but require verified server admin for admin overrides.
BEGIN;

CREATE OR REPLACE FUNCTION public.mark_p2p_trade_paid(
    p_trade_id UUID,
    p_caller_id UUID DEFAULT NULL,
    p_payment_method TEXT DEFAULT NULL
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
    v_is_buyer BOOLEAN := FALSE;
    v_is_admin BOOLEAN := FALSE;
    v_now TIMESTAMPTZ := NOW();
    v_payment_method TEXT;
BEGIN
    -- 1. Authentication Check & Impersonation Prevention
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
        RAISE EXCEPTION 'Trade % not found.', p_trade_id;
    END IF;

    -- 3. Authorization Check (Self-contained, type-safe; does NOT call public.is_admin())
    v_is_buyer := (v_effective_caller::TEXT = v_trade.buyer_id::TEXT);
    -- Browser sessions may mark a trade paid only as the actual buyer.
    -- Admin overrides are server-only and require an active database-backed full-admin identity.
    v_is_admin := FALSE;
    IF auth.role() = 'service_role' THEN
        SELECT EXISTS (
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
        ) OR EXISTS (
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
        INTO v_is_admin;
    END IF;
    IF NOT (v_is_buyer OR v_is_admin) THEN
        RAISE EXCEPTION 'Unauthorized: only the trade buyer or an authorized admin can mark trade % as paid.', p_trade_id;
    END IF;

    -- 4. Terminal State Guards
    IF LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('completed', 'released')
       OR LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) IN ('completed', 'released') THEN
        RAISE EXCEPTION 'Cannot mark trade % as paid: trade is already completed/released.', p_trade_id;
    END IF;

    IF LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('cancelled', 'expired')
       OR LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) IN ('cancelled', 'expired') THEN
        RAISE EXCEPTION 'Cannot mark trade % as paid: trade is in terminal % state.', p_trade_id, v_trade.status;
    END IF;

    IF LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('disputed', 'dispute')
       OR LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) = 'disputed' THEN
        RAISE EXCEPTION 'Cannot mark trade % as paid while a dispute is active.', p_trade_id;
    END IF;

    -- 5. Idempotent Check: Already Paid
    IF (v_trade.paid_at IS NOT NULL OR v_trade.marked_paid_at IS NOT NULL)
       AND (LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('paid', 'buyer_marked_paid', 'payment_sent')
            OR LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) = 'paid') THEN
        RETURN jsonb_build_object(
            'success', true,
            'trade_id', p_trade_id,
            'status', 'paid',
            'escrow_status', 'PAID',
            'paid_at', COALESCE(v_trade.paid_at, v_trade.marked_paid_at),
            'message', 'Trade is already marked as paid (idempotent replay).'
        );
    END IF;

    -- 6. Resolve Payment Method (Preserve agreed trade payment method; fallback to caller input only if existing is NULL/empty)
    v_payment_method := COALESCE(
        NULLIF(TRIM(v_trade.payment_method), ''),
        NULLIF(TRIM(p_payment_method), ''),
        'Bank Transfer'
    );

    -- 7. Atomic Mutation: Update Payment State (NO wallet/escrow balance mutation)
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
ALTER FUNCTION public.mark_p2p_trade_paid(UUID, UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.mark_p2p_trade_paid(UUID, UUID, TEXT) SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION public.mark_p2p_trade_paid(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_p2p_trade_paid(UUID, UUID, TEXT) TO authenticated, service_role, postgres;

COMMIT;
