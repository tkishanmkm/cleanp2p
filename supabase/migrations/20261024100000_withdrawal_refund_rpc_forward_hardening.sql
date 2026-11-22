-- Forward-only hardening for the live withdrawal refund RPC.
-- Never apply to production until replayed against a schema-matched isolated database.
BEGIN;

-- Remove both historical overloads to prevent PostgREST ambiguity and eliminate the
-- older caller-controlled refund implementations.
DROP FUNCTION IF EXISTS public.process_failed_withdrawal(UUID, TEXT);
DROP FUNCTION IF EXISTS public.process_failed_withdrawal(UUID, TEXT, NUMERIC, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.process_failed_withdrawal(UUID, TEXT, NUMERIC, TEXT, BOOLEAN, BOOLEAN);

CREATE FUNCTION public.process_failed_withdrawal(
    p_withdrawal_id UUID,
    p_error_reason TEXT,
    p_actual_gas_amount NUMERIC DEFAULT 0,
    p_gas_asset TEXT DEFAULT NULL,
    p_is_verified_revert BOOLEAN DEFAULT FALSE,
    p_is_verified_unbroadcast BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_withdrawal public.onchain_withdrawals%ROWTYPE;
    v_paired public.withdrawals%ROWTYPE;
    v_balance public.wallet_assets%ROWTYPE;
    v_gross NUMERIC(36,18);
    v_new_balance NUMERIC(36,18);
    v_new_in_withdrawal NUMERIC(36,18);
    v_refund_ledger_exists BOOLEAN := FALSE;
BEGIN
    IF p_withdrawal_id IS NULL THEN
        RAISE EXCEPTION 'withdrawal_id is required';
    END IF;

    -- This RPC does not settle miner/gas costs. Do not accept caller-supplied
    -- gas values as a reason to alter the amount refunded.
    IF p_actual_gas_amount IS NOT NULL AND p_actual_gas_amount <> 0 THEN
        RAISE EXCEPTION 'gas settlement is not supported by this refund RPC';
    END IF;

    -- The legacy unbroadcast boolean is caller input, not evidence. Never trust it.
    IF COALESCE(p_is_verified_unbroadcast, FALSE) THEN
        RAISE EXCEPTION 'caller-supplied unbroadcast flag is not trusted; withdrawal state must prove pre-broadcast';
    END IF;

    -- Keep the same lock order as approve_withdrawal (withdrawals, then onchain_withdrawals)
    -- to reduce deadlock risk when approval and refund requests race.
    SELECT *
      INTO v_paired
      FROM public.withdrawals
     WHERE id = p_withdrawal_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'paired withdrawal record % not found; refund blocked for reconciliation', p_withdrawal_id;
    END IF;

    SELECT *
      INTO v_withdrawal
      FROM public.onchain_withdrawals
     WHERE id = p_withdrawal_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'on-chain withdrawal % not found', p_withdrawal_id;
    END IF;

    SELECT EXISTS (
        SELECT 1
          FROM public.ledger_entries le
         WHERE le.reference_id = p_withdrawal_id::TEXT
           AND le.type = 'withdrawal'
           AND le.status = 'REFUNDED'
    ) INTO v_refund_ledger_exists;

    -- A terminal state is idempotent only when the refund ledger entry proves it.
    IF upper(v_withdrawal.status) IN ('FAILED', 'CANCELLED', 'REJECTED')
       OR lower(COALESCE(v_paired.status, '')) IN ('failed', 'cancelled', 'rejected') THEN
        IF upper(v_withdrawal.status) = 'FAILED'
           AND lower(COALESCE(v_paired.status, '')) = 'failed'
           AND v_refund_ledger_exists THEN
            RETURN jsonb_build_object(
                'success', TRUE,
                'idempotent', TRUE,
                'withdrawal_id', p_withdrawal_id,
                'status', 'FAILED'
            );
        END IF;
        RAISE EXCEPTION 'withdrawal terminal state and refund ledger do not agree; reconciliation required';
    END IF;

    IF upper(v_withdrawal.status) IN ('CONFIRMED', 'COMPLETED')
       OR lower(COALESCE(v_paired.status, '')) IN ('confirmed', 'completed', 'complete') THEN
        RAISE EXCEPTION 'confirmed/completed withdrawal cannot be refunded';
    END IF;

    IF v_refund_ledger_exists THEN
        RAISE EXCEPTION 'refund ledger already exists for a non-terminal withdrawal; reconciliation required';
    END IF;

    -- The live onchain_withdrawals table has no fee column. The paired
    -- withdrawals row is the source of the original network fee reservation.
    -- Refuse refund if the paired rows no longer describe the same obligation.
    IF v_paired.user_id IS DISTINCT FROM v_withdrawal.user_id
       OR v_paired.amount IS DISTINCT FROM v_withdrawal.amount
       OR UPPER(COALESCE(v_paired.asset_symbol, '')) <> UPPER(COALESCE(v_withdrawal.asset_symbol, ''))
       OR UPPER(COALESCE(v_paired.network, '')) <> UPPER(COALESCE(v_withdrawal.network, '')) THEN
        RAISE EXCEPTION 'paired withdrawal identity/amount/asset/network mismatch; refund blocked for reconciliation';
    END IF;

    IF COALESCE(v_withdrawal.amount, 0) <= 0
       OR COALESCE(v_paired.network_fee, 0) < 0 THEN
        RAISE EXCEPTION 'withdrawal amount or paired network fee violates refund invariants';
    END IF;

    v_gross := v_withdrawal.amount + COALESCE(v_paired.network_fee, 0);

    IF COALESCE(p_is_verified_revert, FALSE) THEN
        -- The only broadcast exception is a server-side worker-confirmed chain revert.
        -- The worker can invoke this RPC only with the service-role credential.
        IF NULLIF(BTRIM(v_withdrawal.tx_hash), '') IS NULL THEN
            RAISE EXCEPTION 'verified revert requires a persisted transaction hash';
        END IF;
        IF NULLIF(BTRIM(v_paired.tx_hash), '') IS NOT NULL
           AND lower(BTRIM(v_paired.tx_hash)) <> lower(BTRIM(v_withdrawal.tx_hash)) THEN
            RAISE EXCEPTION 'paired withdrawal transaction hash mismatch';
        END IF;
        IF upper(v_withdrawal.status) NOT IN ('BROADCASTED', 'PROCESSING', 'AMBIGUOUS_BROADCAST')
           AND lower(COALESCE(v_paired.status, '')) NOT IN ('broadcasted', 'processing', 'ambiguous_broadcast') THEN
            RAISE EXCEPTION 'verified revert does not match a broadcast-capable withdrawal state';
        END IF;
    ELSE
        -- No hash and explicitly pre-broadcast states only. PROCESSING and
        -- AMBIGUOUS_BROADCAST always retain funds until chain reconciliation.
        IF NULLIF(BTRIM(v_withdrawal.tx_hash), '') IS NOT NULL
           OR NULLIF(BTRIM(v_paired.tx_hash), '') IS NOT NULL
           OR NULLIF(BTRIM(v_paired.txid), '') IS NOT NULL THEN
            RAISE EXCEPTION 'cannot refund a withdrawal with a recorded transaction hash/txid';
        END IF;
        IF upper(v_withdrawal.status) NOT IN ('PENDING', 'NEEDS_APPROVAL')
           OR lower(COALESCE(v_paired.status, '')) NOT IN ('pending', 'pending_approval', 'pending approval', 'needs_approval') THEN
            RAISE EXCEPTION 'refund blocked unless both withdrawal records prove a pre-broadcast state';
        END IF;
    END IF;

    SELECT *
      INTO v_balance
      FROM public.wallet_assets
     WHERE user_id = v_withdrawal.user_id
       AND upper(asset_symbol) = upper(v_withdrawal.asset_symbol)
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'wallet asset row not found';
    END IF;

    IF v_balance.balance IS NULL OR v_balance.balance < 0
       OR v_balance.in_withdrawal IS NULL
       OR v_balance.in_withdrawal < v_gross THEN
        RAISE EXCEPTION 'withdrawal locked-liability invariant failed; refund blocked';
    END IF;

    v_new_balance := v_balance.balance + v_gross;
    v_new_in_withdrawal := v_balance.in_withdrawal - v_gross;

    UPDATE public.wallet_assets
       SET balance = v_new_balance,
           in_withdrawal = v_new_in_withdrawal,
           updated_at = now()
     WHERE id = v_balance.id;

    -- Match the deployed ledger schema: no wallet_id/delta_available/idempotency_key
    -- columns exist in production ledger_entries; 'withdrawal' is the allowed type.
    INSERT INTO public.ledger_entries (
        user_id, crypto, amount, type, reference_id, balance_after, metadata,
        asset, chain, status, created_at
    ) VALUES (
        v_withdrawal.user_id,
        upper(v_withdrawal.asset_symbol),
        v_gross,
        'withdrawal',
        v_withdrawal.id::TEXT,
        v_new_balance,
        jsonb_build_object(
            'withdrawal_id', v_withdrawal.id,
            'reason', COALESCE(p_error_reason, 'withdrawal_refund'),
            'network', v_withdrawal.network,
            'net_amount', v_withdrawal.amount,
            'fee', COALESCE(v_paired.network_fee, 0),
            'gross_amount', v_gross,
            'refund_kind', CASE WHEN COALESCE(p_is_verified_revert, FALSE) THEN 'verified_chain_revert' ELSE 'pre_broadcast' END
        ),
        upper(v_withdrawal.asset_symbol),
        v_withdrawal.network,
        'REFUNDED',
        now()
    );

    UPDATE public.onchain_withdrawals
       SET status = 'FAILED',
           error_message = COALESCE(p_error_reason, 'withdrawal refunded'),
           updated_at = now()
     WHERE id = v_withdrawal.id;

    UPDATE public.withdrawals
       SET status = 'failed',
           broadcast_error = COALESCE(p_error_reason, 'withdrawal refunded'),
           updated_at = now()
     WHERE id = v_paired.id;

    RETURN jsonb_build_object(
        'success', TRUE,
        'idempotent', FALSE,
        'withdrawal_id', p_withdrawal_id,
        'status', 'FAILED',
        'refunded_amount', v_gross,
        'balance_after', v_new_balance
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.process_failed_withdrawal(UUID, TEXT, NUMERIC, TEXT, BOOLEAN, BOOLEAN)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_failed_withdrawal(UUID, TEXT, NUMERIC, TEXT, BOOLEAN, BOOLEAN)
    TO service_role, postgres;

COMMIT;
