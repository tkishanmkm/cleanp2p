-- Remove user-editable metadata from admin authorization in mark_p2p_trade_paid.
-- Prepared from the current live function definition; validate and apply on staging first.
BEGIN;

CREATE OR REPLACE FUNCTION public.mark_p2p_trade_paid(p_trade_id uuid, p_caller_id uuid DEFAULT NULL::uuid, p_payment_method text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_auth_uid UUID := auth.uid();
    v_effective_caller UUID;

    v_trade RECORD;

    v_is_buyer BOOLEAN := FALSE;
    v_is_admin BOOLEAN := FALSE;

    v_payment_method TEXT;
    v_status TEXT;
    v_escrow_status TEXT;

    v_now TIMESTAMPTZ := NOW();
BEGIN

    -- --------------------------------------------------------
    -- Authentication
    -- --------------------------------------------------------

    IF v_auth_uid IS NOT NULL THEN

        IF p_caller_id IS NOT NULL
           AND p_caller_id <> v_auth_uid THEN
            RAISE EXCEPTION
                'Caller ID mismatch: unauthorized impersonation.';
        END IF;

        v_effective_caller := v_auth_uid;

    ELSE

        IF p_caller_id IS NULL THEN
            RAISE EXCEPTION
                'Authentication required.';
        END IF;

        v_effective_caller := p_caller_id;

    END IF;


    -- --------------------------------------------------------
    -- Lock trade
    -- --------------------------------------------------------

    SELECT *
    INTO v_trade
    FROM public.trades
    WHERE id = p_trade_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Trade % not found.',
            p_trade_id;
    END IF;


    v_status := LOWER(COALESCE(v_trade.status::TEXT, ''));
    v_escrow_status := LOWER(COALESCE(v_trade.escrow_status::TEXT, ''));


    -- --------------------------------------------------------
    -- Authorization
    -- --------------------------------------------------------

    v_is_buyer :=
        v_effective_caller::TEXT =
        v_trade.buyer_id::TEXT;

    v_is_admin :=
        public.is_admin()
        OR EXISTS (
            SELECT 1
            FROM public.app_admins
            WHERE user_id::TEXT = v_effective_caller::TEXT
        )
        OR EXISTS (
            SELECT 1
            FROM auth.users
            WHERE id::TEXT = v_effective_caller::TEXT
              AND (
                    raw_app_meta_data->>'role' = 'admin'
                 OR COALESCE(
                        (raw_app_meta_data->>'is_admin')::BOOLEAN,
                        FALSE
                    ) = TRUE
              )
        );


    IF NOT (v_is_buyer OR v_is_admin) THEN
        RAISE EXCEPTION
            'Unauthorized: only buyer or admin can mark trade paid.';
    END IF;


    -- --------------------------------------------------------
    -- Idempotent already-paid state
    -- --------------------------------------------------------

    IF (
        v_trade.paid_at IS NOT NULL
        OR v_trade.marked_paid_at IS NOT NULL
    )
    AND (
        v_status IN ('paid', 'buyer_marked_paid', 'payment_sent')
        OR v_escrow_status = 'paid'
    ) THEN

        RETURN jsonb_build_object(
            'success', true,
            'trade_id', p_trade_id,
            'status', 'paid',
            'escrow_status', 'PAID',
            'paid_at',
                COALESCE(
                    v_trade.paid_at,
                    v_trade.marked_paid_at
                ),
            'payment_method',
                COALESCE(
                    NULLIF(TRIM(v_trade.payment_method), ''),
                    'Bank Transfer'
                ),
            'message',
                'Already marked as paid; idempotent success.'
        );

    END IF;


    -- --------------------------------------------------------
    -- Terminal guards
    -- --------------------------------------------------------

    IF v_status IN ('completed', 'released')
       OR v_escrow_status IN ('completed', 'released') THEN

        RAISE EXCEPTION
            'Cannot mark completed/released trade as paid.';

    END IF;

    IF v_status IN ('cancelled', 'canceled', 'expired')
       OR v_escrow_status IN ('cancelled', 'canceled', 'expired') THEN

        RAISE EXCEPTION
            'Cannot mark terminal trade % as paid.',
            p_trade_id;

    END IF;

    IF v_status IN ('disputed', 'dispute')
       OR v_escrow_status = 'disputed' THEN

        RAISE EXCEPTION
            'Cannot mark a disputed trade as paid.';

    END IF;


    -- --------------------------------------------------------
    -- CRITICAL:
    -- A trade can only be marked paid AFTER escrow is locked.
    -- --------------------------------------------------------

    IF v_escrow_status <> 'escrow_locked' THEN

        RAISE EXCEPTION
            'Cannot mark trade % paid because escrow is not confirmed locked. Current escrow_status=%',
            p_trade_id,
            v_trade.escrow_status;

    END IF;


    -- --------------------------------------------------------
    -- Preserve agreed payment method
    -- --------------------------------------------------------

    v_payment_method :=
        COALESCE(
            NULLIF(TRIM(v_trade.payment_method), ''),
            NULLIF(TRIM(p_payment_method), ''),
            'Bank Transfer'
        );


    -- --------------------------------------------------------
    -- NO wallet mutation here.
    -- --------------------------------------------------------

    UPDATE public.trades
    SET
        status = 'paid',
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
$function$
;

-- CREATE OR REPLACE preserves the function's existing ACLs.
COMMIT;
