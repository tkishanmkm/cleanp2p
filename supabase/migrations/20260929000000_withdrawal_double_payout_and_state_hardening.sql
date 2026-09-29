-- ============================================================================
-- Supabase Migration: 20260929000000_withdrawal_double_payout_and_state_hardening.sql
-- Description: FINAL WITHDRAWAL FINANCIAL HARDENING & DOUBLE-PAYOUT ELIMINATION
--              1. Replaces complete_onchain_withdrawal:
--                 - Strictly rejects 'failed', 'cancelled', 'rejected' terminal states.
--                 - Enforces global tx_hash uniqueness check in SQL.
--                 - Maintains fail-closed idempotency for legitimate completions.
--              2. Replaces process_failed_withdrawal:
--                 - Blocks refund if tx_hash is present.
--                 - Blocks refund for 'processing' and 'ambiguous_broadcast' unless
--                   explicitly verified as pre-broadcast (p_is_verified_unbroadcast = TRUE).
--                 - Automatically isolates unverified failures into 'AMBIGUOUS_BROADCAST'.
--                 - Strictly preserves funds in in_withdrawal when ambiguous.
--              3. Adds unique constraint on onchain_withdrawals (LOWER(TRIM(tx_hash))).
--              4. Extends status check constraints for AMBIGUOUS_BROADCAST.
--              5. Locks down permissions strictly to service_role and postgres.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Update Status Check Constraints on onchain_withdrawals and withdrawals
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'onchain_withdrawals_status_check' 
          AND conrelid = 'public.onchain_withdrawals'::regclass
    ) THEN
        ALTER TABLE public.onchain_withdrawals DROP CONSTRAINT onchain_withdrawals_status_check;
    END IF;

    ALTER TABLE public.onchain_withdrawals 
        ADD CONSTRAINT onchain_withdrawals_status_check 
        CHECK (status IN (
            'NEEDS_APPROVAL', 
            'PENDING_APPROVAL', 
            'QUEUED', 
            'PENDING', 
            'PROCESSING', 
            'AMBIGUOUS_BROADCAST', 
            'BROADCASTED', 
            'CONFIRMED', 
            'COMPLETED', 
            'FAILED', 
            'CANCELLED'
        ));

    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'withdrawals_status_check' 
          AND conrelid = 'public.withdrawals'::regclass
    ) THEN
        ALTER TABLE public.withdrawals DROP CONSTRAINT withdrawals_status_check;
    END IF;

    ALTER TABLE public.withdrawals 
        ADD CONSTRAINT withdrawals_status_check 
        CHECK (status IN (
            'pending', 
            'PENDING_APPROVAL', 
            'QUEUED', 
            'approved', 
            'processing', 
            'AMBIGUOUS_BROADCAST', 
            'broadcasting', 
            'broadcasted', 
            'BROADCASTED', 
            'completed', 
            'failed', 
            'rejected', 
            'cancelled'
        ));
END $$;

-- ----------------------------------------------------------------------------
-- 2. Enforce Global Unique Index on onchain_withdrawals.tx_hash
-- ----------------------------------------------------------------------------
-- Any non-null, non-empty tx_hash must be globally unique across all withdrawals
CREATE UNIQUE INDEX IF NOT EXISTS uq_onchain_withdrawals_tx_hash 
ON public.onchain_withdrawals (LOWER(TRIM(tx_hash))) 
WHERE tx_hash IS NOT NULL AND TRIM(tx_hash) <> '';

-- ----------------------------------------------------------------------------
-- 3. Drop Existing / Overloaded Function Signatures
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.complete_onchain_withdrawal(UUID, TEXT, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.complete_onchain_withdrawal(UUID, TEXT);
DROP FUNCTION IF EXISTS public.process_failed_withdrawal(UUID, TEXT, NUMERIC, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.process_failed_withdrawal(UUID, TEXT);
DROP FUNCTION IF EXISTS public.acquire_withdrawal_worker_lock();
DROP FUNCTION IF EXISTS public.release_withdrawal_worker_lock();

-- ----------------------------------------------------------------------------
-- 4. Hardened complete_onchain_withdrawal Procedure
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_onchain_withdrawal(
    p_withdrawal_id UUID,
    p_tx_hash TEXT,
    p_actual_gas_amount NUMERIC DEFAULT 0,
    p_gas_asset TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_withdrawal RECORD;
    v_total_deducted NUMERIC(36, 18);
    v_fee NUMERIC(36, 18) := 0;
    v_balance_after NUMERIC(36, 18);
    v_in_withdrawal_after NUMERIC(36, 18);
    v_current_in_withdrawal NUMERIC(36, 18);
    v_tx_hash_clean TEXT;
BEGIN
    -- 1. Input Validation
    IF p_withdrawal_id IS NULL THEN
        RAISE EXCEPTION 'Withdrawal ID is required';
    END IF;

    v_tx_hash_clean := LOWER(TRIM(COALESCE(p_tx_hash, '')));
    IF v_tx_hash_clean = '' THEN
        RAISE EXCEPTION 'Transaction hash is required to complete withdrawal';
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

    -- 3. CRITICAL TERMINAL-STATE PROTECTION:
    -- A failed, refunded, cancelled, or rejected withdrawal must NEVER be completed!
    IF LOWER(v_withdrawal.status) IN ('failed', 'cancelled', 'rejected') THEN
        RAISE EXCEPTION 'SECURITY_VIOLATION: Cannot complete withdrawal % in terminal state % (already failed/refunded/cancelled)', 
            p_withdrawal_id, v_withdrawal.status;
    END IF;

    -- 4. Idempotency Check on Already Confirmed / Completed
    IF LOWER(v_withdrawal.status) IN ('confirmed', 'completed') THEN
        IF v_withdrawal.tx_hash IS NOT NULL AND LOWER(TRIM(v_withdrawal.tx_hash)) IS DISTINCT FROM v_tx_hash_clean THEN
            RAISE EXCEPTION 'Financial conflict: withdrawal % already completed with tx_hash %, cannot change to %',
                p_withdrawal_id, v_withdrawal.tx_hash, p_tx_hash;
        END IF;
        RETURN jsonb_build_object('success', true, 'message', 'Already confirmed', 'withdrawal_id', p_withdrawal_id);
    END IF;

    -- 5. Global Transaction Hash Uniqueness Check
    -- Guarantees that ONE blockchain transaction cannot settle TWO different withdrawals
    IF EXISTS (
        SELECT 1 FROM public.onchain_withdrawals 
        WHERE LOWER(TRIM(tx_hash)) = v_tx_hash_clean 
          AND id <> p_withdrawal_id
    ) THEN
        RAISE EXCEPTION 'SECURITY_VIOLATION: Transaction hash % is already associated with another withdrawal', p_tx_hash;
    END IF;

    -- 6. Extract Authoritative Deducted Amount (Principal + Network Fee)
    IF v_withdrawal.metadata IS NOT NULL AND v_withdrawal.metadata ? 'total_deducted' THEN
        v_total_deducted := (v_withdrawal.metadata->>'total_deducted')::NUMERIC;
    ELSE
        IF v_withdrawal.metadata IS NOT NULL AND v_withdrawal.metadata ? 'fee' THEN
            v_fee := (v_withdrawal.metadata->>'fee')::NUMERIC;
        END IF;
        v_total_deducted := v_withdrawal.amount + COALESCE(v_fee, 0);
    END IF;

    -- 7. Lock and Deduct in_withdrawal Liability on wallet_assets
    SELECT in_withdrawal INTO v_current_in_withdrawal
    FROM public.wallet_assets
    WHERE user_id = v_withdrawal.user_id AND asset_symbol = v_withdrawal.asset_symbol
    FOR UPDATE;

    IF v_current_in_withdrawal IS NULL OR v_current_in_withdrawal < v_total_deducted THEN
        RAISE EXCEPTION 'Financial state inconsistency: user % in_withdrawal liability (%) is less than required deduction (%)',
            v_withdrawal.user_id, COALESCE(v_current_in_withdrawal, 0), v_total_deducted;
    END IF;

    UPDATE public.wallet_assets
    SET in_withdrawal = in_withdrawal - v_total_deducted,
        updated_at = NOW()
    WHERE user_id = v_withdrawal.user_id AND asset_symbol = v_withdrawal.asset_symbol
    RETURNING balance, in_withdrawal INTO v_balance_after, v_in_withdrawal_after;

    -- 8. Mark onchain_withdrawals as COMPLETED
    UPDATE public.onchain_withdrawals
    SET status = 'COMPLETED',
        tx_hash = p_tx_hash,
        updated_at = NOW()
    WHERE id = p_withdrawal_id;

    -- 9. Update withdrawals table
    UPDATE public.withdrawals
    SET status = 'completed',
        tx_hash = p_tx_hash,
        txid = p_tx_hash,
        broadcasted_at = COALESCE(broadcasted_at, NOW()),
        updated_at = NOW()
    WHERE id = p_withdrawal_id;

    -- 10. Record Double-Entry Completion Ledger Entry
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
        0,
        -v_total_deducted,
        COALESCE(v_balance_after, 0),
        COALESCE(v_in_withdrawal_after, 0),
        'withdrawal_complete',
        'withdrawals',
        p_withdrawal_id::TEXT,
        'wcomp_' || p_withdrawal_id::TEXT,
        NOW()
    ) ON CONFLICT (idempotency_key) DO NOTHING;

    RETURN jsonb_build_object(
        'success', true,
        'withdrawal_id', p_withdrawal_id,
        'status', 'COMPLETED',
        'tx_hash', p_tx_hash
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Hardened process_failed_withdrawal Procedure
-- ----------------------------------------------------------------------------
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
        in_withdrawal = GREATEST(0, in_withdrawal - v_total_refund),
        updated_at = NOW()
    WHERE user_id = v_withdrawal.user_id AND asset_symbol = v_withdrawal.asset_symbol
    RETURNING balance, in_withdrawal INTO v_balance_after, v_in_withdrawal_after;

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

-- ----------------------------------------------------------------------------
-- 6. Withdrawal Worker Distributed Singleton Advisory Lock Procedures
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acquire_withdrawal_worker_lock()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN pg_try_advisory_lock(987654321);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_withdrawal_worker_lock()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN pg_advisory_unlock(987654321);
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. Strict Privilege Hardening
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.complete_onchain_withdrawal(UUID, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_onchain_withdrawal(UUID, TEXT, NUMERIC, TEXT) TO service_role, postgres;

REVOKE ALL ON FUNCTION public.process_failed_withdrawal(UUID, TEXT, NUMERIC, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_failed_withdrawal(UUID, TEXT, NUMERIC, TEXT, BOOLEAN) TO service_role, postgres;

REVOKE ALL ON FUNCTION public.acquire_withdrawal_worker_lock() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_withdrawal_worker_lock() TO service_role, postgres;

REVOKE ALL ON FUNCTION public.release_withdrawal_worker_lock() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_withdrawal_worker_lock() TO service_role, postgres;

COMMIT;
