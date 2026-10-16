-- Restore P2P escrow fee accounting without reverting live authorization hardening.
-- Baseline is the current production release_trade_escrow definition, inspected read-only.
-- Execute only after SQL integration tests on a fully initialized disposable database.
BEGIN;

CREATE OR REPLACE FUNCTION public.release_trade_escrow(p_trade_id uuid, p_caller_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_auth_uid UUID := auth.uid();
    v_effective_caller UUID;
    v_trade RECORD;
    v_crypto_symbol TEXT;
    v_seller_bal NUMERIC(36, 18);
    v_seller_escrow NUMERIC(36, 18);
    v_buyer_bal NUMERIC(36, 18);
    v_buyer_escrow NUMERIC(36, 18);
    v_seller_bal_after NUMERIC(36, 18);
    v_seller_escrow_after NUMERIC(36, 18);
    v_buyer_bal_after NUMERIC(36, 18);
    v_buyer_escrow_after NUMERIC(36, 18);
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

    -- Resolve the asset code from the final row shape without assuming a legacy column exists.
    -- The migration history has used crypto, asset, crypto_currency, asset_symbol and asset_code.
    v_crypto_symbol := UPPER(COALESCE(
        NULLIF(TRIM(to_jsonb(v_trade)->>'crypto'), ''),
        NULLIF(TRIM(to_jsonb(v_trade)->>'asset'), ''),
        NULLIF(TRIM(to_jsonb(v_trade)->>'crypto_currency'), ''),
        NULLIF(TRIM(to_jsonb(v_trade)->>'asset_symbol'), ''),
        NULLIF(TRIM(to_jsonb(v_trade)->>'asset_code'), ''),
        NULLIF(TRIM(to_jsonb(v_trade)->>'coin'), '')
    ));

    IF v_crypto_symbol IS NULL THEN
        RAISE EXCEPTION 'Trade % has no resolvable asset code', p_trade_id;
    END IF;

    v_total_escrow := v_trade.crypto_amount + COALESCE(v_trade.escrow_fee, 0.0);

    -- 3. Lock Wallet Assets FOR UPDATE (Defensive ::TEXT casting)
    SELECT balance, in_escrow INTO v_seller_bal, v_seller_escrow
    FROM public.wallet_assets
    WHERE user_id::TEXT = v_trade.seller_id::TEXT AND asset_symbol = v_crypto_symbol
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Seller wallet_assets record not found for user % and asset %', v_trade.seller_id, v_crypto_symbol;
    END IF;

    -- Ensure Buyer wallet_assets exists
    INSERT INTO public.wallet_assets (
        user_id,
        asset_symbol,
        balance,
        in_escrow,
        created_at,
        updated_at
    )
    VALUES (
        v_trade.buyer_id::UUID,
        v_crypto_symbol,
        0.0,
        0.0,
        NOW(),
        NOW()
    )
    ON CONFLICT (user_id, asset_symbol) DO NOTHING;

    SELECT balance, in_escrow INTO v_buyer_bal, v_buyer_escrow
    FROM public.wallet_assets
    WHERE user_id::TEXT = v_trade.buyer_id::TEXT AND asset_symbol = v_crypto_symbol
    FOR UPDATE;

    -- 4. Release Payment Guard (ENUM safe: explicit status::TEXT before COALESCE)
    v_is_paid := (v_trade.paid_at IS NOT NULL)
              OR (v_trade.marked_paid_at IS NOT NULL)
              OR (LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) IN ('paid', 'completed', 'released'))
              OR (LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('paid', 'buyer_marked_paid', 'payment_sent', 'disputed', 'dispute', 'completed', 'released'));

    IF NOT v_is_paid THEN
        RAISE EXCEPTION 'Trade % cannot be released before payment is marked.', p_trade_id;
    END IF;

    -- 5. Dispute & Participant Authorization Guard (Cast enum status to text for LOWER())
    v_is_disputed := (LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) = 'disputed')
                  OR (LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('disputed', 'dispute'))
                  OR EXISTS (SELECT 1 FROM public.disputes WHERE trade_id = p_trade_id AND LOWER(status::text) = 'open');

    v_is_admin := public.is_admin()
               OR EXISTS (
                   SELECT 1 FROM auth.users
                   WHERE id = v_effective_caller
                     AND ((raw_app_meta_data->>'role') = 'admin')
               );

    IF v_is_disputed THEN
        IF NOT v_is_admin THEN
            RAISE EXCEPTION 'Trade % is currently in dispute. Only an authorized admin can resolve and release escrow.', p_trade_id;
        END IF;
    ELSE
        IF (v_effective_caller::TEXT <> v_trade.seller_id::TEXT) AND NOT v_is_admin THEN
            RAISE EXCEPTION 'Unauthorized: only the seller or an authorized admin can release escrow for trade %.', p_trade_id;
        END IF;
    END IF;

    -- 6. Terminal State & Replay Safety (ENUM safe)
    IF LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('cancelled', 'expired') OR LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) IN ('cancelled', 'expired') THEN
        RAISE EXCEPTION 'Cannot release trade % in terminal state %.', p_trade_id, v_trade.status;
    END IF;

    IF LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('completed', 'released') OR LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) IN ('completed', 'released') THEN
        IF COALESCE(v_trade.escrow_fee, 0) > 0 THEN
            PERFORM public.record_platform_ledger_entry(
                p_entry_type := 'trade_fee_collected',
                p_asset_code := v_crypto_symbol,
                p_amount := v_trade.escrow_fee,
                p_direction := 'CREDIT',
                p_related_user_id := v_trade.seller_id::UUID,
                p_ref_table := 'trades',
                p_ref_id := p_trade_id::TEXT,
                p_network_code := NULL,
                p_tx_hash := NULL,
                p_idempotency_key := 'pf_p2pfee_' || p_trade_id::TEXT,
                p_metadata := jsonb_build_object(
                    'trade_id', p_trade_id,
                    'crypto_amount', v_trade.crypto_amount,
                    'escrow_fee', v_trade.escrow_fee,
                    'buyer_id', v_trade.buyer_id,
                    'seller_id', v_trade.seller_id
                )
            );
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'trade_id', p_trade_id,
            'status', v_trade.status,
            'escrow_status', 'RELEASED',
            'message', 'Already released (idempotent success)'
        );
    END IF;

    -- 7. Atomic Financial Settlement Mutations
    IF v_seller_escrow < v_total_escrow THEN
        RAISE EXCEPTION 'Insufficient in_escrow balance for seller %: required %, available in escrow %',
            v_trade.seller_id, v_total_escrow, v_seller_escrow;
    END IF;

    -- 7a. Decrement Seller in_escrow liability
    UPDATE public.wallet_assets
    SET in_escrow = in_escrow - v_total_escrow,
        updated_at = NOW()
    WHERE user_id::TEXT = v_trade.seller_id::TEXT
      AND asset_symbol = v_crypto_symbol
      AND in_escrow >= v_total_escrow
    RETURNING balance, in_escrow INTO v_seller_bal_after, v_seller_escrow_after;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fail-closed: could not update seller wallet_assets in_escrow for trade %', p_trade_id;
    END IF;

    -- 7b. Record Seller Release Ledger Entry
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
        v_crypto_symbol,
        v_crypto_symbol,
        0.0,
        'transfer',
        'trade_rel_seller:' || p_trade_id::TEXT,
        v_seller_bal_after,
        jsonb_build_object(
            'action', 'escrow_release_seller',
            'trade_id', p_trade_id,
            'released_escrow', v_total_escrow
        ),
        'completed'
    );

    -- 7c. Increment Buyer spendable balance
    UPDATE public.wallet_assets
    SET balance = balance + v_trade.crypto_amount,
        updated_at = NOW()
    WHERE user_id::TEXT = v_trade.buyer_id::TEXT
      AND asset_symbol = v_crypto_symbol
    RETURNING balance, in_escrow INTO v_buyer_bal_after, v_buyer_escrow_after;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fail-closed: could not update buyer wallet_assets balance for trade %', p_trade_id;
    END IF;

    -- 7d. Record Buyer Release Ledger Entry
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
        v_trade.buyer_id::UUID,
        v_crypto_symbol,
        v_crypto_symbol,
        +v_trade.crypto_amount,
        'transfer',
        'trade_rel_buyer:' || p_trade_id::TEXT,
        v_buyer_bal_after,
        jsonb_build_object(
            'action', 'escrow_release_buyer',
            'trade_id', p_trade_id,
            'credited_amount', v_trade.crypto_amount
        ),
        'completed'
    );

    -- Record the platform fee in the same transaction as wallet settlement.
    IF COALESCE(v_trade.escrow_fee, 0) > 0 THEN
        PERFORM public.record_platform_ledger_entry(
            p_entry_type := 'trade_fee_collected',
            p_asset_code := v_crypto_symbol,
            p_amount := v_trade.escrow_fee,
            p_direction := 'CREDIT',
            p_related_user_id := v_trade.seller_id::UUID,
            p_ref_table := 'trades',
            p_ref_id := p_trade_id::TEXT,
            p_network_code := NULL,
            p_tx_hash := NULL,
            p_idempotency_key := 'pf_p2pfee_' || p_trade_id::TEXT,
            p_metadata := jsonb_build_object(
                'trade_id', p_trade_id,
                'crypto_amount', v_trade.crypto_amount,
                'escrow_fee', v_trade.escrow_fee,
                'buyer_id', v_trade.buyer_id,
                'seller_id', v_trade.seller_id
            )
        );
    END IF;

    -- 7e. Update Trade State to Completed
    UPDATE public.trades
    SET status = 'completed',
        escrow_status = 'RELEASED',
        released_at = NOW(),
        completed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_trade_id;

    -- 7f. Resolve Active Dispute if present (Cast enum status to text for LOWER())
    UPDATE public.disputes
    SET status = 'resolved'
    WHERE trade_id = p_trade_id AND LOWER(status::text) = 'open';

    RETURN jsonb_build_object(
        'success', true,
        'trade_id', p_trade_id,
        'status', 'completed',
        'escrow_status', 'RELEASED'
    );
END;
$function$;

COMMIT;
