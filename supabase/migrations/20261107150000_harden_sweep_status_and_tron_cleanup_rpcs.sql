-- Harden sweep state transitions and TRON pre-broadcast resource cleanup.
-- Every status transition requires the current live worker lease. Cleanup is
-- restricted to unsigned pre-broadcast TRON sweeps with an active delegation.
BEGIN;

DO $dependencies$
DECLARE
    v_ready_check text;
BEGIN
    IF to_regclass('public.sweep_operations') IS NULL
       OR to_regclass('public.resource_delegation_operations') IS NULL
       OR to_regclass('public.onchain_deposits') IS NULL
       OR to_regclass('public.utxo_reservations') IS NULL THEN
        RAISE EXCEPTION 'Required sweep/delegation/deposit/UTXO tables are missing';
    END IF;

    IF to_regprocedure('public.update_sweep_operation_status(uuid,text,text,text,text,numeric,text,integer)') IS NULL
       OR to_regprocedure('public.verify_and_lock_pre_broadcast_cleanup(uuid,text)') IS NULL
       OR to_regprocedure('public.initialize_resource_delegation(uuid,text,text,text,bigint,bigint)') IS NULL THEN
        RAISE EXCEPTION 'Expected sweep/delegation RPC is missing';
    END IF;

    SELECT pg_catalog.pg_get_constraintdef(c.oid)
      INTO v_ready_check
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.sweep_operations'::regclass
      AND c.conname = 'sweep_operations_status_check'
      AND c.convalidated IS TRUE;

    IF v_ready_check IS NULL
       OR pg_catalog.strpos(v_ready_check, 'READY_TO_BROADCAST') = 0 THEN
        RAISE EXCEPTION 'Apply the validated READY_TO_BROADCAST status repair before this sweep RPC hardening';
    END IF;
END;
$dependencies$;

CREATE OR REPLACE FUNCTION public.update_sweep_operation_status(
    p_sweep_id uuid,
    p_worker_id text,
    p_expected_status text,
    p_new_status text,
    p_tx_hash text DEFAULT NULL,
    p_amount_swept numeric DEFAULT NULL,
    p_error_message text DEFAULT NULL,
    p_extend_lease_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_sweep public.sweep_operations%ROWTYPE;
    v_now timestamptz := pg_catalog.clock_timestamp();
    v_expected_status text := upper(pg_catalog.btrim(coalesce(p_expected_status, '')));
    v_new_status text := upper(pg_catalog.btrim(coalesce(p_new_status, '')));
    v_hash text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_tx_hash, ''))), '');
    v_effective_hash text;
    v_valid_transition boolean := false;
    v_rows integer := 0;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Service role required to update sweep state'
            USING ERRCODE = '42501';
    END IF;

    IF p_sweep_id IS NULL
       OR p_worker_id IS NULL
       OR pg_catalog.btrim(p_worker_id) = ''
       OR pg_catalog.length(p_worker_id) > 128
       OR v_expected_status = ''
       OR v_new_status NOT IN (
           'CLAIMED', 'GAS_FUNDING', 'GAS_FUNDED', 'READY_TO_BROADCAST',
           'BROADCASTED', 'CONFIRMED', 'FAILED', 'RECOVERY_REQUIRED'
       )
       OR p_extend_lease_seconds IS NULL
       OR p_extend_lease_seconds < 30
       OR p_extend_lease_seconds > 1800
       OR (p_amount_swept IS NOT NULL AND p_amount_swept < 0)
       OR (p_error_message IS NOT NULL AND pg_catalog.length(p_error_message) > 1000)
       OR (v_hash IS NOT NULL AND pg_catalog.length(v_hash) > 160) THEN
        RAISE EXCEPTION 'Invalid sweep state transition payload'
            USING ERRCODE = '22023';
    END IF;

    SELECT *
      INTO v_sweep
    FROM public.sweep_operations
    WHERE id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false, 'code', 'SWEEP_NOT_FOUND'
        );
    END IF;

    -- No stale worker may settle, fail, or otherwise mutate a sweep after the
    -- lease expires. Terminal recovery must first be claimed by a live worker.
    IF v_sweep.worker_id IS DISTINCT FROM p_worker_id
       OR v_sweep.lease_expires_at IS NULL
       OR v_sweep.lease_expires_at <= v_now THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false, 'code', 'ACTIVE_LEASE_REQUIRED'
        );
    END IF;

    IF upper(coalesce(v_sweep.status, '')) IS DISTINCT FROM v_expected_status THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'code', 'STATE_MISMATCH',
            'current_status', v_sweep.status
        );
    END IF;

    CASE v_expected_status
        WHEN 'PENDING' THEN
            v_valid_transition := v_new_status IN ('CLAIMED', 'FAILED');
        WHEN 'CLAIMED' THEN
            v_valid_transition := v_new_status IN (
                'GAS_FUNDING', 'GAS_FUNDED', 'READY_TO_BROADCAST',
                'FAILED', 'RECOVERY_REQUIRED'
            );
        WHEN 'GAS_FUNDING' THEN
            v_valid_transition := v_new_status IN (
                'GAS_FUNDED', 'READY_TO_BROADCAST', 'FAILED', 'RECOVERY_REQUIRED'
            );
        WHEN 'GAS_FUNDED' THEN
            v_valid_transition := v_new_status IN (
                'READY_TO_BROADCAST', 'FAILED', 'RECOVERY_REQUIRED'
            );
        WHEN 'READY_TO_BROADCAST' THEN
            v_valid_transition := v_new_status IN (
                'BROADCASTED', 'FAILED', 'RECOVERY_REQUIRED'
            );
        WHEN 'BROADCASTED' THEN
            v_valid_transition := v_new_status IN (
                'CONFIRMED', 'FAILED', 'RECOVERY_REQUIRED'
            );
        WHEN 'RECOVERY_REQUIRED' THEN
            v_valid_transition := v_new_status IN ('BROADCASTED', 'CONFIRMED', 'FAILED');
        ELSE
            v_valid_transition := false;
    END CASE;

    IF NOT v_valid_transition THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'code', 'INVALID_STATE_TRANSITION',
            'current_status', v_sweep.status,
            'requested_status', v_new_status
        );
    END IF;

    IF v_expected_status = 'RECOVERY_REQUIRED'
       AND v_new_status = 'BROADCASTED'
       AND (
           nullif(pg_catalog.btrim(coalesce(v_sweep.signed_tx_hex, '')), '') IS NULL
           OR nullif(pg_catalog.btrim(coalesce(v_sweep.sweep_tx_hash, '')), '') IS NULL
       ) THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'code', 'DURABLE_SIGNED_PAYLOAD_REQUIRED'
        );
    END IF;

    IF v_hash IS NOT NULL
       AND nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(v_sweep.sweep_tx_hash, ''))), '') IS NOT NULL
       AND pg_catalog.lower(pg_catalog.btrim(v_sweep.sweep_tx_hash)) IS DISTINCT FROM v_hash THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false, 'code', 'TX_HASH_MUTATION_REJECTED'
        );
    END IF;

    v_effective_hash := coalesce(
        v_hash,
        nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(v_sweep.sweep_tx_hash, ''))), '')
    );

    IF v_new_status IN ('READY_TO_BROADCAST', 'BROADCASTED', 'CONFIRMED')
       AND v_effective_hash IS NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false, 'code', 'SWEEP_TX_HASH_REQUIRED'
        );
    END IF;

    IF v_new_status IN ('READY_TO_BROADCAST', 'BROADCASTED', 'CONFIRMED') THEN
        IF upper(coalesce(v_sweep.network, '')) IN ('ERC20', 'ETHEREUM', 'ETH', 'BEP20', 'BSC', 'BINANCE')
           AND v_effective_hash !~ '^0x[0-9a-f]{64}$' THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false, 'code', 'INVALID_EVM_SWEEP_TX_HASH'
            );
        ELSIF upper(coalesce(v_sweep.network, '')) IN ('TRC20', 'TRON', 'BTC', 'LTC')
           AND v_effective_hash !~ '^[0-9a-f]{64}$' THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', false, 'code', 'INVALID_SWEEP_TX_HASH'
            );
        END IF;
    END IF;

    -- A nonce-bearing EVM sweep cannot be marked FAILED, because that would
    -- release its reserved input state while the consumed nonce/transaction
    -- still needs receipt-based or operator reconciliation.
    IF v_new_status = 'FAILED'
       AND (
           v_sweep.nonce IS NOT NULL
           OR (
               upper(coalesce(v_sweep.network, '')) IN ('ERC20', 'ETHEREUM', 'ETH', 'BEP20', 'BSC', 'BINANCE')
               AND nullif(pg_catalog.btrim(coalesce(v_sweep.signed_tx_hex, '')), '') IS NOT NULL
           )
       ) THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', false,
            'code', 'NONCED_SWEEP_CANNOT_FAIL',
            'message', 'A sweep with an allocated EVM nonce or persisted signed transaction must remain in recovery until reconciled.'
        );
    END IF;

    IF v_new_status = 'CONFIRMED' AND p_amount_swept IS NULL THEN
        RAISE EXCEPTION 'Confirmed sweep requires its verified swept amount'
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.sweep_operations
    SET status = v_new_status,
        lease_expires_at = CASE
            WHEN v_new_status IN ('CONFIRMED', 'FAILED', 'RECOVERY_REQUIRED') THEN NULL
            ELSE v_now + pg_catalog.make_interval(secs => p_extend_lease_seconds)
        END,
        sweep_tx_hash = coalesce(v_effective_hash, sweep_tx_hash),
        amount_swept = coalesce(p_amount_swept, amount_swept),
        error_message = CASE
            WHEN p_error_message IS NULL THEN error_message
            ELSE pg_catalog.left(p_error_message, 1000)
        END,
        updated_at = v_now
    WHERE id = p_sweep_id
      AND worker_id = p_worker_id
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at > v_now
      AND upper(status) = v_expected_status;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Sweep ownership or state changed before the transition committed'
            USING ERRCODE = '42501';
    END IF;

    IF v_new_status = 'CONFIRMED' THEN
        UPDATE public.onchain_deposits
        SET is_swept = true,
            swept_tx_hash = coalesce(v_effective_hash, swept_tx_hash),
            updated_at = v_now
        WHERE id = v_sweep.deposit_id;

        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows <> 1 THEN
            RAISE EXCEPTION 'Confirmed sweep does not have exactly one canonical deposit row'
                USING ERRCODE = '23503';
        END IF;

        UPDATE public.utxo_reservations
        SET status = 'CONFIRMED',
            reserved_until = v_now + interval '1 day'
        WHERE sweep_id = p_sweep_id;
    ELSIF v_new_status = 'RECOVERY_REQUIRED' THEN
        UPDATE public.utxo_reservations
        SET status = 'RECOVERY_REQUIRED',
            reserved_until = v_now + interval '7 days'
        WHERE sweep_id = p_sweep_id;
    ELSIF v_new_status = 'FAILED' THEN
        UPDATE public.utxo_reservations
        SET status = 'RELEASED',
            reserved_until = v_now
        WHERE sweep_id = p_sweep_id
          AND status = 'RESERVED';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'sweep_id', p_sweep_id,
        'status', v_new_status,
        'tx_hash', v_effective_hash
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.verify_and_lock_pre_broadcast_cleanup(
    p_sweep_id uuid,
    p_worker_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_sweep public.sweep_operations%ROWTYPE;
    v_delegation public.resource_delegation_operations%ROWTYPE;
    v_now timestamptz := pg_catalog.clock_timestamp();
    v_rows integer;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Service role required for pre-broadcast TRON resource cleanup'
            USING ERRCODE = '42501';
    END IF;

    IF p_sweep_id IS NULL
       OR p_worker_id IS NULL
       OR pg_catalog.btrim(p_worker_id) = ''
       OR pg_catalog.length(p_worker_id) > 128 THEN
        RAISE EXCEPTION 'Invalid pre-broadcast cleanup request'
            USING ERRCODE = '22023';
    END IF;

    SELECT *
      INTO v_sweep
    FROM public.sweep_operations
    WHERE id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'can_undelegate', false, 'code', 'SWEEP_NOT_FOUND'
        );
    END IF;

    IF v_sweep.worker_id IS DISTINCT FROM p_worker_id
       OR v_sweep.lease_expires_at IS NULL
       OR v_sweep.lease_expires_at <= v_now THEN
        RETURN pg_catalog.jsonb_build_object(
            'can_undelegate', false, 'code', 'ACTIVE_LEASE_REQUIRED'
        );
    END IF;

    IF upper(coalesce(v_sweep.network, '')) NOT IN ('TRC20', 'TRON')
       OR upper(coalesce(v_sweep.asset_symbol, '')) <> 'USDT'
       OR upper(coalesce(v_sweep.status, '')) NOT IN ('CLAIMED', 'GAS_FUNDING', 'GAS_FUNDED') THEN
        RETURN pg_catalog.jsonb_build_object(
            'can_undelegate', false,
            'code', 'INVALID_PRE_BROADCAST_SWEEP_STATE',
            'status', v_sweep.status
        );
    END IF;

    -- A nonce, signed sweep payload or deterministic sweep hash means a
    -- transaction identity may already be committed. Never reclaim Energy
    -- through the pre-broadcast cleanup path in that state.
    IF v_sweep.nonce IS NOT NULL
       OR nullif(pg_catalog.btrim(coalesce(v_sweep.signed_tx_hex, '')), '') IS NOT NULL
       OR nullif(pg_catalog.btrim(coalesce(v_sweep.sweep_tx_hash, '')), '') IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'can_undelegate', false, 'code', 'SWEEP_TRANSACTION_IDENTITY_EXISTS'
        );
    END IF;

    SELECT *
      INTO v_delegation
    FROM public.resource_delegation_operations
    WHERE sweep_id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND
       OR upper(coalesce(v_delegation.status, '')) NOT IN ('DELEGATING', 'DELEGATED') THEN
        RETURN pg_catalog.jsonb_build_object(
            'can_undelegate', false, 'code', 'NO_ACTIVE_DELEGATION'
        );
    END IF;

    IF nullif(pg_catalog.btrim(coalesce(v_delegation.signed_undelegation_hex, '')), '') IS NOT NULL
       OR nullif(pg_catalog.btrim(coalesce(v_delegation.undelegation_tx_hash, '')), '') IS NOT NULL THEN
        RETURN pg_catalog.jsonb_build_object(
            'can_undelegate', false, 'code', 'UNDELEGATION_ALREADY_HAS_TRANSACTION_IDENTITY'
        );
    END IF;

    UPDATE public.sweep_operations
    SET status = 'RECOVERY_REQUIRED',
        error_message = 'Pre-broadcast failure. Cleaning up TRON resources.',
        updated_at = v_now
    WHERE id = p_sweep_id
      AND worker_id = p_worker_id
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at > v_now
      AND status IN ('CLAIMED', 'GAS_FUNDING', 'GAS_FUNDED')
      AND nonce IS NULL
      AND nullif(pg_catalog.btrim(coalesce(signed_tx_hex, '')), '') IS NULL
      AND nullif(pg_catalog.btrim(coalesce(sweep_tx_hash, '')), '') IS NULL;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RETURN pg_catalog.jsonb_build_object(
            'can_undelegate', false, 'code', 'SWEEP_OWNERSHIP_OR_STATE_CHANGED'
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'can_undelegate', true,
        'status', 'RECOVERY_REQUIRED',
        'delegated_amount_sun', v_delegation.delegated_amount_sun,
        'receiver_address', v_delegation.receiver_address
    );
END;
$function$;

-- This legacy initializer can reset a delegation row to PENDING. The current
-- server uses claim_or_initialize_resource_delegation instead; no other
-- postgres function calls this legacy helper. Keep it only for owner-internal
-- compatibility, never for service_role or browser execution.
ALTER FUNCTION public.initialize_resource_delegation(uuid,text,text,text,bigint,bigint)
    SET search_path = '';

REVOKE ALL ON FUNCTION public.update_sweep_operation_status(uuid,text,text,text,text,numeric,text,integer)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.update_sweep_operation_status(uuid,text,text,text,text,numeric,text,integer)
    TO service_role, postgres;

REVOKE ALL ON FUNCTION public.verify_and_lock_pre_broadcast_cleanup(uuid,text)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.verify_and_lock_pre_broadcast_cleanup(uuid,text)
    TO service_role, postgres;

REVOKE ALL ON FUNCTION public.initialize_resource_delegation(uuid,text,text,text,bigint,bigint)
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.initialize_resource_delegation(uuid,text,text,text,bigint,bigint)
    TO postgres;

COMMENT ON FUNCTION public.update_sweep_operation_status(uuid,text,text,text,text,numeric,text,integer) IS
    'Service-only sweep state machine. Every transition requires the active unexpired row lease; CAS updates preserve hash identity and prevent failed nonced EVM sweeps from releasing reservations.';
COMMENT ON FUNCTION public.verify_and_lock_pre_broadcast_cleanup(uuid,text) IS
    'Service-only TRON cleanup gate. Allows undelegation only for an actively leased, unsigned pre-broadcast TRON USDT sweep with a valid active delegation.';
COMMENT ON FUNCTION public.initialize_resource_delegation(uuid,text,text,text,bigint,bigint) IS
    'Legacy delegation initializer retained for postgres-internal compatibility only; application execution is revoked.';

NOTIFY pgrst, 'reload schema';

COMMIT;
