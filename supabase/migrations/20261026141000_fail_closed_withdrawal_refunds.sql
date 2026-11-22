-- Preserve the hardened six-argument withdrawal refund RPC created by
-- 20261024100000_withdrawal_refund_rpc_forward_hardening.sql.
-- The previous body downgraded its signature, trusted a caller-supplied unbroadcast flag,
-- and used ledger columns absent from the audited production schema.
-- This guard intentionally fails closed until the full chain is replayed on a
-- schema-matched disposable database. It does not modify the refund function.
BEGIN;

DO $migration$
DECLARE
  v_hardened_signature regprocedure := to_regprocedure('public.process_failed_withdrawal(uuid,text,numeric,text,boolean,boolean)');
  v_legacy_signature regprocedure := to_regprocedure('public.process_failed_withdrawal(uuid,text,numeric,text,boolean)');
BEGIN
  IF v_hardened_signature IS NULL THEN
    RAISE EXCEPTION 'Hardened six-argument process_failed_withdrawal RPC is missing; refusing unsafe downgrade.';
  END IF;
  IF v_legacy_signature IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy five-argument process_failed_withdrawal overload still exists; resolve overload ambiguity before proceeding.';
  END IF;
END;
$migration$;

/* DISABLED unsafe historical implementation; do not execute.
CREATE OR REPLACE FUNCTION public.process_failed_withdrawal(
    p_withdrawal_id UUID,
    p_error_reason TEXT,
    p_actual_gas_amount NUMERIC DEFAULT 0,
    p_gas_asset TEXT DEFAULT NULL,
    p_is_verified_unbroadcast BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_withdrawal RECORD;
    v_fee NUMERIC(36, 18) := 0;
    v_total_refund NUMERIC(36, 18);
    v_balance_after NUMERIC(36, 18);
    v_in_withdrawal_after NUMERIC(36, 18);
BEGIN
    -- 1. Input Validation
    IF p_withdrawal_id IS NULL THEN
        RAISE EXCEPTION 'Withdrawal ID is required';
    END IF;

    -- 2. Lock Withdrawal Record FOR UPDATE
    SELECT *
    INTO v_withdrawal
    FROM public.onchain_withdrawals
    WHERE id = p_withdrawal_id
    FOR UPDATE;

    IF NOT FOUND THEN
        SELECT id, user_id, wallet_id, amount, asset_symbol, network, status, tx_hash, metadata
        INTO v_withdrawal
        FROM public.withdrawals
        WHERE id = p_withdrawal_id
        FOR UPDATE;
    END IF;

    IF v_withdrawal.id IS NULL THEN
        RAISE EXCEPTION 'Withdrawal % not found', p_withdrawal_id;
    END IF;

    -- 3. Idempotency Check: If already failed, do not refund again
    IF LOWER(v_withdrawal.status) = 'failed' THEN
        RETURN jsonb_build_object('success', true, 'message', 'Already marked as failed', 'withdrawal_id', p_withdrawal_id);
    END IF;

    -- 4. Terminal State Protection: Completed withdrawals can NEVER be refunded!
    IF LOWER(v_withdrawal.status) IN ('confirmed', 'completed') THEN
        RAISE EXCEPTION 'SECURITY_VIOLATION: Cannot refund completed withdrawal %', p_withdrawal_id;
    END IF;

    -- 5. Cancelled State Protection
    IF LOWER(v_withdrawal.status) = 'cancelled' THEN
        RAISE EXCEPTION 'Withdrawal % is already cancelled', p_withdrawal_id;
    END IF;

    -- 6. CRITICAL BROADCAST SAFETY CHECK #1:
    -- If tx_hash is populated, an on-chain transaction was broadcast. Refuse refund UNLESS verified on-chain revert is proven!
    IF v_withdrawal.tx_hash IS NOT NULL AND TRIM(v_withdrawal.tx_hash) <> '' AND NOT COALESCE(p_is_verified_unbroadcast, FALSE) THEN
        RAISE EXCEPTION 'SECURITY_VIOLATION: Cannot refund withdrawal % because tx_hash % is recorded. Must verify on-chain revert before refunding.',
            p_withdrawal_id, v_withdrawal.tx_hash;
    END IF;

    -- 7. CRITICAL BROADCAST SAFETY CHECK #2 (AMBIGUOUS BROADCAST TRAP):
    -- If withdrawal is in PROCESSING or AMBIGUOUS_BROADCAST and caller has NOT proven
    -- that the failure occurred pre-broadcast, REFUND IS PROHIBITED!
    IF LOWER(v_withdrawal.status) IN ('processing', 'ambiguous_broadcast') AND NOT COALESCE(p_is_verified_unbroadcast, FALSE) THEN
        -- Transition to AMBIGUOUS_BROADCAST. Funds remain safely reserved in in_withdrawal!
        UPDATE public.onchain_withdrawals
        SET status = 'AMBIGUOUS_BROADCAST',
            error_message = COALESCE(p_error_reason, 'Ambiguous broadcast failure - pending manual blockchain verification'),
            updated_at = NOW()
        WHERE id = p_withdrawal_id;

        UPDATE public.withdrawals
        SET status = 'AMBIGUOUS_BROADCAST',
            broadcast_error = COALESCE(p_error_reason, 'Ambiguous broadcast failure - pending manual blockchain verification'),
            updated_at = NOW()
        WHERE id = p_withdrawal_id;

        -- Create high-priority system alert for operations
        INSERT INTO public.system_alerts (
            alert_type, severity, title, message, metadata, created_at
        ) VALUES (
            'WORKER_ERROR',
            'CRITICAL',
            'Ambiguous Withdrawal Broadcast Detected',
            format('Withdrawal %s (%s %s on %s) timed out or failed ambiguously during broadcast. Refund blocked until verified.',
                   p_withdrawal_id, v_withdrawal.amount, v_withdrawal.asset_symbol, v_withdrawal.network),
            jsonb_build_object(
                'withdrawal_id', p_withdrawal_id,
                'user_id', v_withdrawal.user_id,
                'amount', v_withdrawal.amount,
                'asset', v_withdrawal.asset_symbol,
                'network', v_withdrawal.network,
                'status', 'AMBIGUOUS_BROADCAST',
                'reason', p_error_reason
            ),
            NOW()
        );

        RETURN jsonb_build_object(
            'success', false,
            'code', 'AMBIGUOUS_BROADCAST_REFUND_BLOCKED',
            'withdrawal_id', p_withdrawal_id,
            'status', 'AMBIGUOUS_BROADCAST',
            'message', 'Refund blocked: withdrawal was in broadcast stage. Funds remain reserved in in_withdrawal pending operator verification.'
        );
    END IF;

    -- 8. Extract Authoritative Refund Amount (Principal + Network Fee)
    IF v_withdrawal.metadata IS NOT NULL AND v_withdrawal.metadata ? 'total_deducted' THEN
        v_total_refund := (v_withdrawal.metadata->>'total_deducted')::NUMERIC;
    ELSE
        IF v_withdrawal.metadata IS NOT NULL AND v_withdrawal.metadata ? 'fee' THEN
            v_fee := (v_withdrawal.metadata->>'fee')::NUMERIC;
        END IF;
        v_total_refund := v_withdrawal.amount + COALESCE(v_fee, 0);
    END IF;

    -- 9. Credit User Spendable Balance and Release in_withdrawal Liability
    UPDATE public.wallet_assets
    SET balance = balance + v_total_refund,
        in_withdrawal = in_withdrawal - v_total_refund,
        updated_at = NOW()
    WHERE user_id = v_withdrawal.user_id
      AND asset_symbol = v_withdrawal.asset_symbol
      AND in_withdrawal >= v_total_refund
    RETURNING balance, in_withdrawal INTO v_balance_after, v_in_withdrawal_after;

    -- Fail closed if the wallet row is missing or the reserved liability is insufficient.
    -- Raising here rolls back all changes in this transaction; never mark refunded without crediting.
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Refund blocked: wallet asset row missing or reserved withdrawal liability is insufficient for %', p_withdrawal_id
            USING ERRCODE = 'P0001', DETAIL = 'WITHDRAWAL_REFUND_RECONCILIATION_REQUIRED';
    END IF;

    -- 10. Mark onchain_withdrawals as FAILED
    UPDATE public.onchain_withdrawals
    SET status = 'FAILED',
        error_message = COALESCE(p_error_reason, 'Worker pre-broadcast validation failure'),
        updated_at = NOW()
    WHERE id = p_withdrawal_id;

    -- 11. Update withdrawals table
    UPDATE public.withdrawals
    SET status = 'failed',
        broadcast_error = COALESCE(p_error_reason, 'Worker pre-broadcast validation failure'),
        updated_at = NOW()
    WHERE id = p_withdrawal_id;

    -- 12. Record Double-Entry Refund Ledger Entry
    INSERT INTO public.ledger_entries (
        wallet_id,
        user_id,
        asset_code,
        delta_available,
        delta_locked,
        available_after,
        locked_after,
        entry_type,
        ref_table,
        ref_id,
        idempotency_key,
        created_at
    ) VALUES (
        v_withdrawal.wallet_id,
        v_withdrawal.user_id,
        v_withdrawal.asset_symbol,
        +v_total_refund,
        -v_total_refund,
        COALESCE(v_balance_after, 0),
        COALESCE(v_in_withdrawal_after, 0),
        'withdrawal_refund',
        'withdrawals',
        p_withdrawal_id::TEXT,
        'wrefund_' || p_withdrawal_id::TEXT,
        NOW()
    ) ON CONFLICT (idempotency_key) DO NOTHING;

    RETURN jsonb_build_object(
        'success', true,
        'withdrawal_id', p_withdrawal_id,
        'refunded_amount', v_total_refund,
        'status', 'FAILED'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.process_failed_withdrawal(UUID, TEXT, NUMERIC, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_failed_withdrawal(UUID, TEXT, NUMERIC, TEXT, BOOLEAN) TO service_role, postgres;

*/

COMMIT;
