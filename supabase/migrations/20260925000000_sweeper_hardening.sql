-- ============================================================================
-- Supabase Migration: 20260925000000_sweeper_hardening.sql
-- Description: Production Custodial Deposit Sweeper Hardening Schema & RPCs
--              1. sweep_operations table with atomic lease & state machine
--              2. gas_funding_operations table with idempotency locks & nonces
--              3. utxo_reservations table for BTC/LTC UTXO concurrency locking
--              4. deposit_address_nonces table for derived EVM wallet nonces
--              5. Atomic claim, state update, verification, and gas funding RPCs
-- ============================================================================

BEGIN;

-- 1. Create sweep_operations table
CREATE TABLE IF NOT EXISTS public.sweep_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deposit_id UUID NOT NULL REFERENCES public.onchain_deposits(id) ON DELETE CASCADE,
    deposit_address TEXT NOT NULL,
    network TEXT NOT NULL,
    asset_symbol TEXT NOT NULL DEFAULT 'USDT',
    derivation_index INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
        'PENDING', 'CLAIMED', 'GAS_FUNDING', 'GAS_FUNDED', 'BROADCASTED', 'CONFIRMED', 'FAILED', 'RECOVERY_REQUIRED'
    )),
    worker_id TEXT,
    lease_expires_at TIMESTAMPTZ,
    gas_funding_tx_hash TEXT,
    sweep_tx_hash TEXT,
    amount_swept NUMERIC(36, 18) DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_sweep_operations_deposit UNIQUE (deposit_id)
);

CREATE INDEX IF NOT EXISTS idx_sweep_operations_status_lease ON public.sweep_operations(status, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_sweep_operations_deposit_addr ON public.sweep_operations(deposit_address);

-- Enable RLS
ALTER TABLE public.sweep_operations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'sweep_operations' AND policyname = 'Service role full access to sweep_operations'
    ) THEN
        CREATE POLICY "Service role full access to sweep_operations"
            ON public.sweep_operations FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

-- 2. Create gas_funding_operations table
CREATE TABLE IF NOT EXISTS public.gas_funding_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sweep_id UUID NOT NULL REFERENCES public.sweep_operations(id) ON DELETE CASCADE,
    deposit_address TEXT NOT NULL,
    network TEXT NOT NULL,
    amount_allocated NUMERIC(36, 18) NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'BROADCASTED', 'CONFIRMED', 'FAILED', 'RECOVERY_REQUIRED')),
    tx_hash TEXT,
    nonce BIGINT,
    worker_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_gas_funding_sweep UNIQUE (sweep_id)
);

CREATE INDEX IF NOT EXISTS idx_gas_funding_status ON public.gas_funding_operations(status);

ALTER TABLE public.gas_funding_operations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'gas_funding_operations' AND policyname = 'Service role full access to gas_funding_operations'
    ) THEN
        CREATE POLICY "Service role full access to gas_funding_operations"
            ON public.gas_funding_operations FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

-- 3. Create utxo_reservations table for BTC/LTC
CREATE TABLE IF NOT EXISTS public.utxo_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    txid TEXT NOT NULL,
    vout INTEGER NOT NULL,
    network TEXT NOT NULL,
    sweep_id UUID NOT NULL REFERENCES public.sweep_operations(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'BROADCASTED', 'CONFIRMED', 'RELEASED', 'RECOVERY_REQUIRED')),
    reserved_until TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_utxo_reservations_tx_vout_net UNIQUE (txid, vout, network)
);

CREATE INDEX IF NOT EXISTS idx_utxo_reservations_until ON public.utxo_reservations(reserved_until);

ALTER TABLE public.utxo_reservations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'utxo_reservations' AND policyname = 'Service role full access to utxo_reservations'
    ) THEN
        CREATE POLICY "Service role full access to utxo_reservations"
            ON public.utxo_reservations FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

-- 4. Create deposit_address_nonces table for derived EVM wallet nonces
CREATE TABLE IF NOT EXISTS public.deposit_address_nonces (
    deposit_address TEXT PRIMARY KEY,
    network_code TEXT NOT NULL,
    current_nonce BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.deposit_address_nonces ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'deposit_address_nonces' AND policyname = 'Service role full access to deposit_address_nonces'
    ) THEN
        CREATE POLICY "Service role full access to deposit_address_nonces"
            ON public.deposit_address_nonces FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

-- 5. RPC: Atomic claim next sweep operation (WITH FOR UPDATE SKIP LOCKED)
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
SET search_path = public, pg_temp
AS $$
DECLARE
    v_candidate RECORD;
    v_new_lease TIMESTAMPTZ := NOW() + (p_lease_duration_seconds || ' seconds')::INTERVAL;
BEGIN
    -- Auto-create sweep_operations for confirmed unswept deposits not yet in sweep_operations
    INSERT INTO public.sweep_operations (deposit_id, deposit_address, network, asset_symbol, derivation_index, status)
    SELECT 
        d.id,
        COALESCE(d.address, d.to_address),
        UPPER(TRIM(d.network)),
        UPPER(TRIM(COALESCE(d.asset_symbol, 'USDT'))),
        0,
        'PENDING'
    FROM public.onchain_deposits d
    WHERE d.status = 'CONFIRMED'
      AND d.is_swept = FALSE
      AND NOT EXISTS (SELECT 1 FROM public.sweep_operations s WHERE s.deposit_id = d.id)
    ON CONFLICT (deposit_id) DO NOTHING;

    -- Select next eligible pending or recoverable expired sweep using FOR UPDATE SKIP LOCKED
    SELECT s.id INTO v_candidate
    FROM public.sweep_operations s
    WHERE s.status = 'PENDING'
       OR (s.status IN ('CLAIMED', 'GAS_FUNDING', 'GAS_FUNDED') AND s.lease_expires_at < NOW())
    ORDER BY s.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF v_candidate IS NULL THEN
        RETURN;
    END IF;

    -- Atomically update status to CLAIMED and set lease
    UPDATE public.sweep_operations s
    SET status = 'CLAIMED',
        worker_id = p_worker_id,
        lease_expires_at = v_new_lease,
        updated_at = NOW()
    WHERE s.id = v_candidate.id;

    RETURN QUERY
    SELECT 
        s.id AS sweep_id,
        s.deposit_id,
        s.deposit_address,
        s.network,
        s.asset_symbol,
        s.derivation_index,
        s.status,
        s.lease_expires_at
    FROM public.sweep_operations s
    WHERE s.id = v_candidate.id;
END;
$$;

-- 6. RPC: Atomic Status Transition with Strict State Machine Validation
CREATE OR REPLACE FUNCTION public.update_sweep_operation_status(
    p_sweep_id UUID,
    p_worker_id TEXT,
    p_expected_status TEXT,
    p_new_status TEXT,
    p_tx_hash TEXT DEFAULT NULL,
    p_amount_swept NUMERIC DEFAULT NULL,
    p_error_message TEXT DEFAULT NULL,
    p_extend_lease_seconds INTEGER DEFAULT 300
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sweep RECORD;
    v_new_lease TIMESTAMPTZ := NOW() + (p_extend_lease_seconds || ' seconds')::INTERVAL;
    v_valid_transition BOOLEAN := FALSE;
BEGIN
    IF p_expected_status IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'MISSING_EXPECTED_STATUS', 'message', 'p_expected_status parameter is required');
    END IF;

    SELECT * INTO v_sweep
    FROM public.sweep_operations
    WHERE id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'SWEEP_NOT_FOUND', 'message', 'Sweep operation not found');
    END IF;

    -- Validate worker ownership
    IF v_sweep.worker_id IS DISTINCT FROM p_worker_id THEN
        RETURN jsonb_build_object('success', false, 'code', 'WORKER_MISMATCH', 'message', 'Sweep operation belongs to another worker');
    END IF;

    -- Validate lease expiry for non-terminal states
    IF v_sweep.lease_expires_at < NOW() AND p_new_status NOT IN ('FAILED', 'RECOVERY_REQUIRED') THEN
        RETURN jsonb_build_object('success', false, 'code', 'LEASE_EXPIRED', 'message', 'Worker lease has expired');
    END IF;

    -- Validate expected current status
    IF v_sweep.status <> p_expected_status THEN
        RETURN jsonb_build_object('success', false, 'code', 'STATE_MISMATCH', 'message', 'Current state ' || v_sweep.status || ' does not match expected ' || p_expected_status);
    END IF;

    -- Strict State Machine Transition Rules
    CASE p_expected_status
        WHEN 'PENDING' THEN
            v_valid_transition := p_new_status IN ('CLAIMED', 'FAILED');
        WHEN 'CLAIMED' THEN
            v_valid_transition := p_new_status IN ('GAS_FUNDING', 'GAS_FUNDED', 'BROADCASTED', 'FAILED', 'RECOVERY_REQUIRED');
        WHEN 'GAS_FUNDING' THEN
            v_valid_transition := p_new_status IN ('GAS_FUNDED', 'FAILED', 'RECOVERY_REQUIRED');
        WHEN 'GAS_FUNDED' THEN
            v_valid_transition := p_new_status IN ('BROADCASTED', 'FAILED', 'RECOVERY_REQUIRED');
        WHEN 'BROADCASTED' THEN
            v_valid_transition := p_new_status IN ('CONFIRMED', 'FAILED', 'RECOVERY_REQUIRED');
        WHEN 'RECOVERY_REQUIRED' THEN
            v_valid_transition := p_new_status IN ('CONFIRMED', 'FAILED');
        ELSE
            v_valid_transition := FALSE;
    END CASE;

    IF NOT v_valid_transition THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_STATE_TRANSITION', 'message', 'Transition from ' || p_expected_status || ' to ' || p_new_status || ' is invalid');
    END IF;

    -- Update sweep operation record
    UPDATE public.sweep_operations
    SET status = p_new_status,
        lease_expires_at = CASE WHEN p_new_status IN ('CONFIRMED', 'FAILED', 'RECOVERY_REQUIRED') THEN NULL ELSE v_new_lease END,
        sweep_tx_hash = COALESCE(p_tx_hash, sweep_tx_hash),
        amount_swept = COALESCE(p_amount_swept, amount_swept),
        error_message = COALESCE(p_error_message, error_message),
        updated_at = NOW()
    WHERE id = p_sweep_id;

    -- Handle cascade updates
    IF p_new_status = 'CONFIRMED' THEN
        UPDATE public.onchain_deposits
        SET is_swept = TRUE,
            swept_tx_hash = COALESCE(p_tx_hash, swept_tx_hash),
            updated_at = NOW()
        WHERE id = v_sweep.deposit_id;

        UPDATE public.utxo_reservations
        SET status = 'CONFIRMED', reserved_until = NOW() + INTERVAL '1 day'
        WHERE sweep_id = p_sweep_id;
    ELSIF p_new_status = 'RECOVERY_REQUIRED' THEN
        UPDATE public.utxo_reservations
        SET status = 'RECOVERY_REQUIRED', reserved_until = NOW() + INTERVAL '7 days'
        WHERE sweep_id = p_sweep_id;
    ELSIF p_new_status = 'FAILED' THEN
        UPDATE public.utxo_reservations
        SET status = 'RELEASED', reserved_until = NOW()
        WHERE sweep_id = p_sweep_id AND status = 'RESERVED';
    END IF;

    RETURN jsonb_build_object('success', true, 'sweep_id', p_sweep_id, 'status', p_new_status);
END;
$$;

-- 7. RPC: Pre-broadcast Worker Ownership & Lease Verification
CREATE OR REPLACE FUNCTION public.verify_sweep_ownership(
    p_sweep_id UUID,
    p_worker_id TEXT,
    p_expected_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sweep RECORD;
BEGIN
    SELECT * INTO v_sweep
    FROM public.sweep_operations
    WHERE id = p_sweep_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'SWEEP_NOT_FOUND');
    END IF;

    IF v_sweep.worker_id IS DISTINCT FROM p_worker_id THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'WORKER_MISMATCH');
    END IF;

    IF v_sweep.lease_expires_at <= NOW() THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'LEASE_EXPIRED');
    END IF;

    IF p_expected_status IS NOT NULL AND v_sweep.status <> p_expected_status THEN
        RETURN jsonb_build_object('valid', false, 'reason', 'STATUS_MISMATCH', 'current_status', v_sweep.status);
    END IF;

    -- Extend lease atomically on successful verification
    UPDATE public.sweep_operations
    SET lease_expires_at = NOW() + INTERVAL '300 seconds',
        updated_at = NOW()
    WHERE id = p_sweep_id;

    RETURN jsonb_build_object('valid', true);
END;
$$;

-- 8. RPC: Heartbeat Lease Extension
CREATE OR REPLACE FUNCTION public.extend_sweep_lease(
    p_sweep_id UUID,
    p_worker_id TEXT,
    p_extend_seconds INTEGER DEFAULT 300
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sweep RECORD;
BEGIN
    SELECT * INTO v_sweep
    FROM public.sweep_operations
    WHERE id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND OR v_sweep.worker_id IS DISTINCT FROM p_worker_id OR v_sweep.lease_expires_at <= NOW() THEN
        RETURN jsonb_build_object('success', false, 'code', 'LEASE_INVALID');
    END IF;

    UPDATE public.sweep_operations
    SET lease_expires_at = NOW() + (p_extend_seconds || ' seconds')::INTERVAL,
        updated_at = NOW()
    WHERE id = p_sweep_id;

    RETURN jsonb_build_object('success', true);
END;
$$;

-- 9. RPC: Reserve UTXOs Atomically for BTC/LTC
CREATE OR REPLACE FUNCTION public.reserve_utxos_for_sweep(
    p_sweep_id UUID,
    p_network TEXT,
    p_utxos JSONB,
    p_lease_seconds INTEGER DEFAULT 300
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_utxo JSONB;
    v_txid TEXT;
    v_vout INTEGER;
    v_until TIMESTAMPTZ := NOW() + (p_lease_seconds || ' seconds')::INTERVAL;
    v_conflict_count INTEGER := 0;
BEGIN
    -- Purge ONLY safely RELEASED or non-broadcast expired reservations
    DELETE FROM public.utxo_reservations
    WHERE reserved_until < NOW()
      AND status = 'RESERVED';

    -- Check for conflicts against any active or un-reconciled reservation
    FOR v_utxo IN SELECT * FROM jsonb_array_elements(p_utxos)
    LOOP
        v_txid := v_utxo->>'txid';
        v_vout := (v_utxo->>'vout')::INTEGER;

        IF EXISTS (
            SELECT 1 FROM public.utxo_reservations
            WHERE txid = v_txid 
              AND vout = v_vout 
              AND network = UPPER(TRIM(p_network)) 
              AND sweep_id <> p_sweep_id
              AND status IN ('RESERVED', 'BROADCASTED', 'RECOVERY_REQUIRED')
        ) THEN
            v_conflict_count := v_conflict_count + 1;
        END IF;
    END LOOP;

    IF v_conflict_count > 0 THEN
        RETURN jsonb_build_object('success', false, 'code', 'UTXO_CONFLICT', 'message', 'UTXOs are reserved or in recovery by another sweep');
    END IF;

    -- Insert or update reservations
    FOR v_utxo IN SELECT * FROM jsonb_array_elements(p_utxos)
    LOOP
        v_txid := v_utxo->>'txid';
        v_vout := (v_utxo->>'vout')::INTEGER;

        INSERT INTO public.utxo_reservations (txid, vout, network, sweep_id, status, reserved_until)
        VALUES (v_txid, v_vout, UPPER(TRIM(p_network)), p_sweep_id, 'RESERVED', v_until)
        ON CONFLICT (txid, vout, network)
        DO UPDATE SET sweep_id = EXCLUDED.sweep_id, status = 'RESERVED', reserved_until = EXCLUDED.reserved_until;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'count', jsonb_array_length(p_utxos));
END;
$$;

-- 10. RPC: Claim Gas Funding Operation Atomically
CREATE OR REPLACE FUNCTION public.claim_gas_funding_operation(
    p_sweep_id UUID,
    p_deposit_address TEXT,
    p_network TEXT,
    p_amount_allocated NUMERIC,
    p_worker_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_existing RECORD;
BEGIN
    SELECT * INTO v_existing
    FROM public.gas_funding_operations
    WHERE sweep_id = p_sweep_id
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing.status IN ('CONFIRMED', 'BROADCASTED', 'RECOVERY_REQUIRED') THEN
            RETURN jsonb_build_object('success', false, 'already_funded', true, 'tx_hash', v_existing.tx_hash, 'status', v_existing.status);
        END IF;
    ELSE
        INSERT INTO public.gas_funding_operations (sweep_id, deposit_address, network, amount_allocated, status, worker_id)
        VALUES (p_sweep_id, p_deposit_address, UPPER(TRIM(p_network)), p_amount_allocated, 'PENDING', p_worker_id);
    END IF;

    RETURN jsonb_build_object('success', true, 'already_funded', false);
END;
$$;

-- ============================================================================
-- 11. Security Hardening: Revoke PUBLIC / anon / authenticated permissions
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.claim_next_deposit_sweep(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_sweep_operation_status(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_sweep_ownership(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.extend_sweep_lease(UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_utxos_for_sweep(UUID, TEXT, JSONB, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_gas_funding_operation(UUID, TEXT, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.allocate_hot_wallet_nonce(INTEGER) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_next_deposit_sweep(TEXT, INTEGER) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.update_sweep_operation_status(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, INTEGER) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.verify_sweep_ownership(UUID, TEXT, TEXT) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.extend_sweep_lease(UUID, TEXT, INTEGER) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.reserve_utxos_for_sweep(UUID, TEXT, JSONB, INTEGER) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.claim_gas_funding_operation(UUID, TEXT, TEXT, NUMERIC, TEXT) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.allocate_hot_wallet_nonce(INTEGER) TO service_role, postgres;

COMMIT;
