-- Fence sweep claims, heartbeats, and gas-funding transitions to the current
-- worker lease. A stale worker must never renew a lease now owned by another
-- worker or overwrite the newer worker's gas-funding recovery state.
BEGIN;

CREATE OR REPLACE FUNCTION public.claim_next_deposit_sweep(
    p_worker_id TEXT,
    p_lease_duration_seconds INTEGER DEFAULT 300
)
RETURNS TABLE (
    sweep_id UUID,
    deposit_id UUID,
    deposit_address TEXT,
    network TEXT,
    asset_symbol TEXT,
    derivation_index INTEGER,
    status TEXT,
    lease_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_now TIMESTAMPTZ;
    v_candidate_id UUID;
    v_claimed_id UUID;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Service role required to claim deposit sweeps'
            USING ERRCODE = '42501';
    END IF;

    IF p_worker_id IS NULL
       OR pg_catalog.btrim(p_worker_id) = ''
       OR pg_catalog.length(p_worker_id) > 128
       OR p_lease_duration_seconds IS NULL
       OR p_lease_duration_seconds < 30
       OR p_lease_duration_seconds > 1800 THEN
        RAISE EXCEPTION 'Invalid deposit sweep worker lease request'
            USING ERRCODE = '22023';
    END IF;

    v_now := pg_catalog.clock_timestamp();

    -- Enqueue confirmed deposits that do not yet have a sweep operation.
    INSERT INTO public.sweep_operations (
        deposit_id, deposit_address, network, asset_symbol, derivation_index, status
    )
    SELECT
        d.id,
        coalesce(d.address, d.to_address),
        pg_catalog.upper(pg_catalog.btrim(d.network)),
        pg_catalog.upper(pg_catalog.btrim(coalesce(d.asset_symbol, 'USDT'))),
        0,
        'PENDING'
    FROM public.onchain_deposits AS d
    WHERE d.status = 'CONFIRMED'
      AND d.is_swept IS FALSE
      AND NOT EXISTS (
          SELECT 1
          FROM public.sweep_operations AS existing
          WHERE existing.deposit_id = d.id
      )
    ON CONFLICT (deposit_id) DO NOTHING;

    -- Claim only new or expired work. A row lock serializes competing workers.
    SELECT s.id
      INTO v_candidate_id
    FROM public.sweep_operations AS s
    WHERE s.status = 'PENDING'
       OR (
            s.status IN ('CLAIMED', 'GAS_FUNDING', 'GAS_FUNDED')
            AND (s.lease_expires_at IS NULL OR s.lease_expires_at <= v_now)
       )
    ORDER BY s.created_at ASC, s.id ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_candidate_id IS NULL THEN
        RETURN;
    END IF;

    -- Repeat every eligibility predicate on the write, not just the row ID.
    UPDATE public.sweep_operations AS s
    SET status = 'CLAIMED',
        worker_id = p_worker_id,
        lease_expires_at = v_now + (p_lease_duration_seconds * INTERVAL '1 second'),
        updated_at = v_now
    WHERE s.id = v_candidate_id
      AND (
          s.status = 'PENDING'
          OR (
              s.status IN ('CLAIMED', 'GAS_FUNDING', 'GAS_FUNDED')
              AND (s.lease_expires_at IS NULL OR s.lease_expires_at <= v_now)
          )
      )
    RETURNING s.id INTO v_claimed_id;

    IF v_claimed_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        s.id,
        s.deposit_id,
        s.deposit_address,
        s.network,
        s.asset_symbol,
        s.derivation_index,
        s.status,
        s.lease_expires_at
    FROM public.sweep_operations AS s
    WHERE s.id = v_claimed_id
      AND s.worker_id = p_worker_id
      AND s.lease_expires_at > v_now;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_next_deposit_sweep(TEXT, INTEGER)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.claim_next_deposit_sweep(TEXT, INTEGER)
    TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.verify_sweep_ownership(
    p_sweep_id UUID,
    p_worker_id TEXT,
    p_expected_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_sweep public.sweep_operations%ROWTYPE;
    v_expected_status TEXT := nullif(pg_catalog.upper(pg_catalog.btrim(coalesce(p_expected_status, ''))), '');
    v_now TIMESTAMPTZ;
    v_new_expiry TIMESTAMPTZ;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Service role required to verify sweep ownership'
            USING ERRCODE = '42501';
    END IF;

    IF p_sweep_id IS NULL
       OR p_worker_id IS NULL
       OR pg_catalog.btrim(p_worker_id) = ''
       OR pg_catalog.length(p_worker_id) > 128
       OR (p_expected_status IS NOT NULL AND v_expected_status IS NULL) THEN
        RAISE EXCEPTION 'Invalid sweep ownership verification payload'
            USING ERRCODE = '22023';
    END IF;

    SELECT *
      INTO v_sweep
    FROM public.sweep_operations
    WHERE id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('valid', false, 'reason', 'SWEEP_NOT_FOUND');
    END IF;

    v_now := pg_catalog.clock_timestamp();

    IF v_sweep.worker_id IS DISTINCT FROM p_worker_id THEN
        RETURN pg_catalog.jsonb_build_object('valid', false, 'reason', 'WORKER_MISMATCH');
    END IF;

    IF v_sweep.lease_expires_at IS NULL OR v_sweep.lease_expires_at <= v_now THEN
        RETURN pg_catalog.jsonb_build_object('valid', false, 'reason', 'LEASE_EXPIRED');
    END IF;

    IF pg_catalog.upper(coalesce(v_sweep.status, '')) NOT IN (
        'CLAIMED', 'GAS_FUNDING', 'GAS_FUNDED',
        'READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED'
    ) THEN
        RETURN pg_catalog.jsonb_build_object(
            'valid', false,
            'reason', 'SWEEP_NOT_ACTIVE',
            'current_status', v_sweep.status
        );
    END IF;

    IF v_expected_status IS NOT NULL
       AND pg_catalog.upper(v_sweep.status) IS DISTINCT FROM v_expected_status THEN
        RETURN pg_catalog.jsonb_build_object(
            'valid', false,
            'reason', 'STATUS_MISMATCH',
            'current_status', v_sweep.status
        );
    END IF;

    -- The locked row is renewed only while the same owner and live lease still
    -- match in the UPDATE predicate. This prevents a stale worker extending a
    -- lease after another worker has taken ownership.
    v_new_expiry := v_now + INTERVAL '300 seconds';
    UPDATE public.sweep_operations
    SET lease_expires_at = v_new_expiry,
        updated_at = v_now
    WHERE id = p_sweep_id
      AND worker_id = p_worker_id
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at > v_now
      AND pg_catalog.upper(status) IN (
          'CLAIMED', 'GAS_FUNDING', 'GAS_FUNDED',
          'READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED'
      )
      AND (
          v_expected_status IS NULL
          OR pg_catalog.upper(status) = v_expected_status
      );

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('valid', false, 'reason', 'OWNERSHIP_CHANGED');
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'valid', true,
        'lease_expires_at', v_new_expiry
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.verify_sweep_ownership(UUID, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.verify_sweep_ownership(UUID, TEXT, TEXT)
    TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.extend_sweep_lease(
    p_sweep_id UUID,
    p_worker_id TEXT,
    p_extend_seconds INTEGER DEFAULT 300
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_sweep public.sweep_operations%ROWTYPE;
    v_now TIMESTAMPTZ;
    v_new_expiry TIMESTAMPTZ;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Service role required to extend sweep leases'
            USING ERRCODE = '42501';
    END IF;

    IF p_sweep_id IS NULL
       OR p_worker_id IS NULL
       OR pg_catalog.btrim(p_worker_id) = ''
       OR pg_catalog.length(p_worker_id) > 128
       OR p_extend_seconds IS NULL
       OR p_extend_seconds < 30
       OR p_extend_seconds > 1800 THEN
        RAISE EXCEPTION 'Invalid sweep lease extension request'
            USING ERRCODE = '22023';
    END IF;

    SELECT *
      INTO v_sweep
    FROM public.sweep_operations
    WHERE id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'SWEEP_NOT_FOUND');
    END IF;

    v_now := pg_catalog.clock_timestamp();

    IF v_sweep.worker_id IS DISTINCT FROM p_worker_id
       OR v_sweep.lease_expires_at IS NULL
       OR v_sweep.lease_expires_at <= v_now
       OR pg_catalog.upper(coalesce(v_sweep.status, '')) NOT IN (
           'CLAIMED', 'GAS_FUNDING', 'GAS_FUNDED',
           'READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED'
       ) THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'LEASE_INVALID');
    END IF;

    v_new_expiry := v_now + (p_extend_seconds * INTERVAL '1 second');
    UPDATE public.sweep_operations
    SET lease_expires_at = v_new_expiry,
        updated_at = v_now
    WHERE id = p_sweep_id
      AND worker_id = p_worker_id
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at > v_now
      AND pg_catalog.upper(status) IN (
          'CLAIMED', 'GAS_FUNDING', 'GAS_FUNDED',
          'READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED'
      );

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'OWNERSHIP_CHANGED');
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'lease_expires_at', v_new_expiry
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.extend_sweep_lease(UUID, TEXT, INTEGER)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.extend_sweep_lease(UUID, TEXT, INTEGER)
    TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.update_gas_funding_operation_status(
    p_sweep_id UUID,
    p_worker_id TEXT,
    p_new_status TEXT,
    p_error_message TEXT DEFAULT NULL,
    p_tx_hash TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_sweep public.sweep_operations%ROWTYPE;
    v_gas public.gas_funding_operations%ROWTYPE;
    v_now TIMESTAMPTZ;
    v_new_status TEXT := pg_catalog.upper(pg_catalog.btrim(coalesce(p_new_status, '')));
    v_hash TEXT := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_tx_hash, ''))), '');
    v_required_confirmations INTEGER;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Service role required to update custodial gas funding'
            USING ERRCODE = '42501';
    END IF;

    IF p_sweep_id IS NULL
       OR p_worker_id IS NULL
       OR pg_catalog.btrim(p_worker_id) = ''
       OR pg_catalog.length(p_worker_id) > 128
       OR v_new_status NOT IN ('BROADCASTED', 'CONFIRMED', 'RECOVERY_REQUIRED', 'FAILED')
       OR (p_error_message IS NOT NULL AND pg_catalog.length(p_error_message) > 1000)
       OR (v_hash IS NOT NULL AND v_hash !~ '^(0x)?[0-9a-f]{64}$') THEN
        RAISE EXCEPTION 'Invalid custodial gas-funding state transition payload'
            USING ERRCODE = '22023';
    END IF;

    SELECT *
      INTO v_sweep
    FROM public.sweep_operations
    WHERE id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Gas-funding sweep operation does not exist'
            USING ERRCODE = 'P0002';
    END IF;

    v_now := pg_catalog.clock_timestamp();

    IF v_sweep.worker_id IS DISTINCT FROM p_worker_id
       OR v_sweep.lease_expires_at IS NULL
       OR v_sweep.lease_expires_at <= v_now
       OR pg_catalog.upper(coalesce(v_sweep.status, '')) NOT IN ('GAS_FUNDING', 'GAS_FUNDED') THEN
        RAISE EXCEPTION 'Active GAS_FUNDING/GAS_FUNDED sweep lease is not owned by this worker'
            USING ERRCODE = '42501';
    END IF;

    SELECT *
      INTO v_gas
    FROM public.gas_funding_operations
    WHERE sweep_id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Gas-funding operation does not exist for the sweep'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_gas.worker_id IS DISTINCT FROM p_worker_id THEN
        RAISE EXCEPTION 'Gas-funding operation is not owned by the current sweep worker'
            USING ERRCODE = '42501';
    END IF;

    IF v_hash IS NOT NULL
       AND nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(v_gas.tx_hash, ''))), '') IS NOT NULL
       AND pg_catalog.lower(pg_catalog.btrim(v_gas.tx_hash)) IS DISTINCT FROM v_hash THEN
        RAISE EXCEPTION 'Gas-funding operation already contains a different transaction hash'
            USING ERRCODE = '23505';
    END IF;

    IF v_new_status = 'BROADCASTED'
       AND pg_catalog.upper(v_gas.status) NOT IN ('READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED') THEN
        RAISE EXCEPTION 'Invalid gas-funding transition from % to BROADCASTED', v_gas.status
            USING ERRCODE = '55000';
    END IF;

    IF v_new_status = 'CONFIRMED'
       AND pg_catalog.upper(v_gas.status) NOT IN ('READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED', 'CONFIRMED') THEN
        RAISE EXCEPTION 'Invalid gas-funding transition from % to CONFIRMED', v_gas.status
            USING ERRCODE = '55000';
    END IF;

    IF v_new_status = 'RECOVERY_REQUIRED'
       AND pg_catalog.upper(v_gas.status) NOT IN ('PENDING', 'READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED') THEN
        RAISE EXCEPTION 'Invalid gas-funding transition from % to RECOVERY_REQUIRED', v_gas.status
            USING ERRCODE = '55000';
    END IF;

    IF v_new_status = 'FAILED'
       AND pg_catalog.upper(v_gas.status) NOT IN ('PENDING', 'RECOVERY_REQUIRED', 'FAILED') THEN
        RAISE EXCEPTION 'Invalid gas-funding transition from % to FAILED', v_gas.status
            USING ERRCODE = '55000';
    END IF;

    IF v_new_status = 'CONFIRMED'
       AND coalesce(v_hash, nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(v_gas.tx_hash, ''))), '')) IS NULL THEN
        RAISE EXCEPTION 'Cannot confirm gas funding without its persisted transaction hash'
            USING ERRCODE = '23514';
    END IF;

    IF pg_catalog.upper(v_gas.network) IN ('ERC20', 'BEP20') THEN
        v_required_confirmations := CASE
            WHEN pg_catalog.upper(v_gas.network) = 'ERC20' THEN 12
            ELSE 15
        END;

        IF v_new_status = 'CONFIRMED'
           AND (
               v_gas.funding_receipt_status IS DISTINCT FROM 1
               OR v_gas.funding_receipt_confirmations IS NULL
               OR v_gas.funding_receipt_confirmations < v_required_confirmations
               OR v_gas.actual_funding_tx_gas_used IS NULL
               OR v_gas.actual_funding_tx_effective_gas_price IS NULL
               OR v_gas.actual_funding_tx_fee IS NULL
               OR v_gas.funding_receipt_block_number IS NULL
               OR nullif(pg_catalog.btrim(coalesce(v_gas.funding_receipt_block_hash, '')), '') IS NULL
           ) THEN
            RAISE EXCEPTION 'EVM gas funding cannot be confirmed without a canonical final receipt and actual fee'
                USING ERRCODE = '23514';
        END IF;

        IF v_new_status = 'FAILED'
           AND v_gas.nonce IS NOT NULL
           AND (
               v_gas.funding_receipt_status IS DISTINCT FROM 0
               OR v_gas.funding_receipt_confirmations IS NULL
               OR v_gas.funding_receipt_confirmations < v_required_confirmations
           ) THEN
            RAISE EXCEPTION 'An EVM gas-funding nonce cannot be failed without a final reverted receipt'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    UPDATE public.gas_funding_operations
    SET status = v_new_status,
        worker_id = p_worker_id,
        tx_hash = coalesce(v_hash, tx_hash),
        error_message = CASE
            WHEN p_error_message IS NULL THEN error_message
            ELSE pg_catalog.left(p_error_message, 1000)
        END,
        updated_at = v_now
    WHERE id = v_gas.id
      AND worker_id = p_worker_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Gas-funding ownership changed before status update'
            USING ERRCODE = '42501';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'status', v_new_status,
        'tx_hash', coalesce(v_hash, v_gas.tx_hash),
        'idempotent', pg_catalog.upper(v_gas.status) = v_new_status
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_gas_funding_operation_status(UUID, TEXT, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.update_gas_funding_operation_status(UUID, TEXT, TEXT, TEXT, TEXT)
    TO service_role, postgres;

COMMENT ON FUNCTION public.verify_sweep_ownership(UUID, TEXT, TEXT) IS
    'Service-only, row-locked sweep ownership verification. Lease renewal is conditional on the same current worker and active lease.';
COMMENT ON FUNCTION public.extend_sweep_lease(UUID, TEXT, INTEGER) IS
    'Service-only bounded sweep lease renewal. Expired or unowned leases cannot be revived.';
COMMENT ON FUNCTION public.update_gas_funding_operation_status(UUID, TEXT, TEXT, TEXT, TEXT) IS
    'Service-only gas-funding state transition. Requires current parent lease and matching child operation owner; EVM terminal states require final receipt evidence.';

COMMIT;
