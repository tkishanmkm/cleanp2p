-- ============================================================================
-- Supabase Migration: 20261001020000_gas_funding_broadcast_durability_and_abuse_protection.sql
-- Description: EVM Gas Funding Broadcast Durability, Hot-Wallet Solvency & Abuse Protection
--              1. Adds fee audit & error tracking columns to gas_funding_operations
--              2. Adds performance & audit indexes
--              3. Updates claim_gas_funding_operation to return persisted state for recovery
--              4. Updates persist_signed_gas_funding to durably store nonce and fee accounting
--              5. Creates check_gas_funding_eligibility for cooldown & daily ceiling protection
--              6. Adds chain_id overload for allocate_hot_wallet_nonce
-- ============================================================================

BEGIN;

-- 1. Add schema columns if not existing
ALTER TABLE public.gas_funding_operations
    ADD COLUMN IF NOT EXISTS signed_tx_hex TEXT;

ALTER TABLE public.gas_funding_operations
    ADD COLUMN IF NOT EXISTS funding_tx_fee NUMERIC(36, 18);

ALTER TABLE public.gas_funding_operations
    ADD COLUMN IF NOT EXISTS child_sweep_fee NUMERIC(36, 18);

ALTER TABLE public.gas_funding_operations
    ADD COLUMN IF NOT EXISTS error_message TEXT;

-- 2. Ensure status check constraints include READY_TO_BROADCAST
ALTER TABLE public.gas_funding_operations
    DROP CONSTRAINT IF EXISTS gas_funding_operations_status_check;

ALTER TABLE public.gas_funding_operations
    ADD CONSTRAINT gas_funding_operations_status_check
    CHECK (status IN ('PENDING', 'READY_TO_BROADCAST', 'BROADCASTED', 'CONFIRMED', 'FAILED', 'RECOVERY_REQUIRED'));

-- 3. Add audit and query indexes
CREATE INDEX IF NOT EXISTS idx_gas_funding_address_created
    ON public.gas_funding_operations(deposit_address, network, created_at);

CREATE INDEX IF NOT EXISTS idx_gas_funding_tx_hash
    ON public.gas_funding_operations(tx_hash)
    WHERE tx_hash IS NOT NULL;

-- 4. Hardened RPC: claim_gas_funding_operation
-- Returns existing state (tx_hash, signed_tx_hex, nonce, status) to prevent duplicate signing/nonces
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
    v_sweep RECORD;
    v_norm_network TEXT := UPPER(TRIM(p_network));
BEGIN
    IF p_sweep_id IS NULL OR p_worker_id IS NULL OR TRIM(p_worker_id) = '' THEN
        RAISE EXCEPTION 'Sweep ID and worker ID are required for gas funding claim';
    END IF;
    IF p_deposit_address IS NULL OR TRIM(p_deposit_address) = '' THEN
        RAISE EXCEPTION 'Deposit address is required for gas funding claim';
    END IF;
    IF v_norm_network NOT IN ('ERC20', 'BEP20') THEN
        RAISE EXCEPTION 'Unsupported gas funding network: %', p_network;
    END IF;
    IF p_amount_allocated IS NULL OR p_amount_allocated <= 0 THEN
        RAISE EXCEPTION 'Gas funding amount must be positive';
    END IF;

    -- A gas-funding claim is valid only for the worker holding the live sweep lease.
    SELECT * INTO v_sweep
    FROM public.sweep_operations
    WHERE id = p_sweep_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sweep operation % does not exist', p_sweep_id;
    END IF;
    IF v_sweep.worker_id IS DISTINCT FROM p_worker_id THEN
        RAISE EXCEPTION 'Worker does not own sweep %', p_sweep_id;
    END IF;
    IF v_sweep.lease_expires_at IS NULL OR v_sweep.lease_expires_at <= NOW() THEN
        RAISE EXCEPTION 'Sweep lease expired for %', p_sweep_id;
    END IF;

    SELECT * INTO v_existing
    FROM public.gas_funding_operations
    WHERE sweep_id = p_sweep_id
    FOR UPDATE;

    IF FOUND THEN
        -- If already confirmed
        IF v_existing.status = 'CONFIRMED' THEN
            RETURN jsonb_build_object(
                'success', true,
                'already_funded', true,
                'status', 'CONFIRMED',
                'tx_hash', v_existing.tx_hash,
                'amount_allocated', v_existing.amount_allocated
            );
        END IF;

        -- If signed, broadcasted, or in recovery (MUST NOT re-sign or re-allocate nonce)
        IF v_existing.status IN ('READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED') THEN
            RETURN jsonb_build_object(
                'success', true,
                'already_funded', false,
                'status', v_existing.status,
                'tx_hash', v_existing.tx_hash,
                'signed_tx_hex', v_existing.signed_tx_hex,
                'nonce', v_existing.nonce,
                'amount_allocated', v_existing.amount_allocated,
                'needs_reconciliation', true
            );
        END IF;

        -- If still PENDING, associate active worker
        UPDATE public.gas_funding_operations
        SET worker_id = p_worker_id,
            updated_at = NOW()
        WHERE id = v_existing.id;

        RETURN jsonb_build_object(
            'success', true,
            'already_funded', false,
            'status', 'PENDING',
            'signed_tx_hex', v_existing.signed_tx_hex,
            'tx_hash', v_existing.tx_hash,
            'nonce', v_existing.nonce
        );
    ELSE
        INSERT INTO public.gas_funding_operations (
            sweep_id,
            deposit_address,
            network,
            amount_allocated,
            status,
            worker_id
        )
        VALUES (
            p_sweep_id,
            p_deposit_address,
            v_norm_network,
            p_amount_allocated,
            'PENDING',
            p_worker_id
        );

        RETURN jsonb_build_object(
            'success', true,
            'already_funded', false,
            'status', 'PENDING'
        );
    END IF;
END;
$$;

-- 5. Hardened RPC: persist_signed_gas_funding with nonce & fee tracking
CREATE OR REPLACE FUNCTION public.persist_signed_gas_funding(
    p_sweep_id UUID,
    p_worker_id TEXT,
    p_signed_tx_hex TEXT,
    p_tx_hash TEXT,
    p_nonce BIGINT DEFAULT NULL,
    p_funding_tx_fee NUMERIC DEFAULT NULL,
    p_child_sweep_fee NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sweep RECORD;
    v_gas RECORD;
BEGIN
    SELECT * INTO v_sweep
    FROM public.sweep_operations
    WHERE id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'SWEEP_NOT_FOUND', 'message', 'Sweep operation not found');
    END IF;

    IF v_sweep.worker_id IS DISTINCT FROM p_worker_id THEN
        RETURN jsonb_build_object('success', false, 'code', 'WORKER_MISMATCH', 'message', 'Worker does not own sweep');
    END IF;

    IF v_sweep.lease_expires_at < NOW() THEN
        RETURN jsonb_build_object('success', false, 'code', 'LEASE_EXPIRED', 'message', 'Worker lease expired');
    END IF;

    SELECT * INTO v_gas
    FROM public.gas_funding_operations
    WHERE sweep_id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'GAS_OP_NOT_FOUND', 'message', 'Gas funding operation not found');
    END IF;

    -- Set status to READY_TO_BROADCAST (persisted before network broadcast)
    UPDATE public.gas_funding_operations
    SET signed_tx_hex = TRIM(p_signed_tx_hex),
        tx_hash = TRIM(p_tx_hash),
        nonce = COALESCE(p_nonce, nonce),
        funding_tx_fee = COALESCE(p_funding_tx_fee, funding_tx_fee),
        child_sweep_fee = COALESCE(p_child_sweep_fee, child_sweep_fee),
        status = 'READY_TO_BROADCAST',
        updated_at = NOW()
    WHERE sweep_id = p_sweep_id;

    RETURN jsonb_build_object(
        'success', true,
        'status', 'READY_TO_BROADCAST',
        'tx_hash', TRIM(p_tx_hash),
        'nonce', COALESCE(p_nonce, v_gas.nonce)
    );
END;
$$;

-- 6. RPC: check_gas_funding_eligibility (Abuse Protection, Cooldown & Daily Ceilings)
CREATE OR REPLACE FUNCTION public.check_gas_funding_eligibility(
    p_deposit_address TEXT,
    p_network TEXT,
    p_amount_allocated NUMERIC,
    p_cooldown_seconds INTEGER DEFAULT 300,
    p_daily_limit NUMERIC DEFAULT 0.05,
    p_daily_max_operations INTEGER DEFAULT 5
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_norm_net TEXT := UPPER(TRIM(p_network));
    v_recent_op RECORD;
    v_daily_count INTEGER;
    v_daily_total NUMERIC;
    v_cooldown_cutoff TIMESTAMPTZ := NOW() - (p_cooldown_seconds || ' seconds')::INTERVAL;
    v_daily_cutoff TIMESTAMPTZ := NOW() - INTERVAL '24 hours';
BEGIN
    -- Reject malformed inputs before they can bypass or distort abuse limits.
    IF p_deposit_address IS NULL OR TRIM(p_deposit_address) = '' THEN
        RAISE EXCEPTION 'Deposit address is required for gas funding eligibility';
    END IF;
    IF v_norm_net NOT IN ('ERC20', 'BEP20') THEN
        RAISE EXCEPTION 'Unsupported gas funding network: %', p_network;
    END IF;
    IF p_amount_allocated IS NULL OR p_amount_allocated <= 0 THEN
        RAISE EXCEPTION 'Gas funding amount must be positive';
    END IF;
    IF p_cooldown_seconds IS NULL OR p_cooldown_seconds < 0
       OR p_daily_limit IS NULL OR p_daily_limit <= 0
       OR p_daily_max_operations IS NULL OR p_daily_max_operations <= 0 THEN
        RAISE EXCEPTION 'Gas funding abuse-protection limits must be valid positive values';
    END IF;

    -- 1. Check for cooldown against recent funding operation for this address
    SELECT id, status, created_at, tx_hash INTO v_recent_op
    FROM public.gas_funding_operations
    WHERE deposit_address = p_deposit_address
      AND network = v_norm_net
      AND status IN ('CONFIRMED', 'BROADCASTED', 'READY_TO_BROADCAST')
      AND created_at >= v_cooldown_cutoff
    ORDER BY created_at DESC
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'eligible', false,
            'reason', 'COOLDOWN_ACTIVE',
            'message', 'Gas funding cooldown active for address: previous operation within ' || p_cooldown_seconds || 's',
            'recent_op_id', v_recent_op.id,
            'recent_tx_hash', v_recent_op.tx_hash
        );
    END IF;

    -- 2. Check 24-hour total operations and amount allocated
    SELECT 
        COUNT(*),
        COALESCE(SUM(amount_allocated), 0)
    INTO 
        v_daily_count,
        v_daily_total
    FROM public.gas_funding_operations
    WHERE deposit_address = p_deposit_address
      AND network = v_norm_net
      AND status IN ('CONFIRMED', 'BROADCASTED', 'READY_TO_BROADCAST')
      AND created_at >= v_daily_cutoff;

    IF v_daily_count >= p_daily_max_operations THEN
        RETURN jsonb_build_object(
            'eligible', false,
            'reason', 'DAILY_MAX_OPS_EXCEEDED',
            'message', 'Address exceeded daily maximum gas funding operations (' || v_daily_count || ' >= ' || p_daily_max_operations || ')',
            'daily_count', v_daily_count
        );
    END IF;

    IF (v_daily_total + p_amount_allocated) > p_daily_limit THEN
        RETURN jsonb_build_object(
            'eligible', false,
            'reason', 'DAILY_CEILING_EXCEEDED',
            'message', 'Address funding would exceed 24h ceiling: ' || (v_daily_total + p_amount_allocated) || ' > ' || p_daily_limit,
            'daily_total', v_daily_total,
            'requested', p_amount_allocated,
            'daily_limit', p_daily_limit
        );
    END IF;

    RETURN jsonb_build_object(
        'eligible', true,
        'daily_count', v_daily_count,
        'daily_total', v_daily_total
    );
END;
$$;

-- 7. Add chain_id overload for allocate_hot_wallet_nonce
CREATE OR REPLACE FUNCTION public.allocate_hot_wallet_nonce(
    p_chain_id INTEGER
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_net TEXT;
    v_hot_addr TEXT;
BEGIN
    IF p_chain_id = 1 THEN
        v_net := 'ERC20';
    ELSIF p_chain_id = 56 THEN
        v_net := 'BEP20';
    ELSE
        RAISE EXCEPTION 'Unsupported EVM chain ID for hot wallet nonce allocation: %. Supported: 1 (ERC20), 56 (BEP20)', p_chain_id;
    END IF;

    SELECT hot_wallet_address INTO v_hot_addr
    FROM public.hot_wallet_nonces
    WHERE network_code = v_net;

    -- Never allocate against a fabricated zero address: require the configured
    -- network hot wallet so the nonce counter is bound to the real signer.
    IF v_hot_addr IS NULL OR TRIM(v_hot_addr) = '' THEN
        RAISE EXCEPTION 'Hot wallet is not configured for network %; refusing nonce allocation', v_net;
    END IF;

    RETURN public.allocate_hot_wallet_nonce(v_net, v_hot_addr, 0);
END;
$$;

-- 8. Permissions Hardening
REVOKE EXECUTE ON FUNCTION public.claim_gas_funding_operation(UUID, TEXT, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated, supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.persist_signed_gas_funding(UUID, TEXT, TEXT, TEXT, BIGINT, NUMERIC, NUMERIC) FROM PUBLIC, anon, authenticated, supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.check_gas_funding_eligibility(TEXT, TEXT, NUMERIC, INTEGER, NUMERIC, INTEGER) FROM PUBLIC, anon, authenticated, supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.allocate_hot_wallet_nonce(INTEGER) FROM PUBLIC, anon, authenticated, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION public.claim_gas_funding_operation(UUID, TEXT, TEXT, NUMERIC, TEXT) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.persist_signed_gas_funding(UUID, TEXT, TEXT, TEXT, BIGINT, NUMERIC, NUMERIC) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.check_gas_funding_eligibility(TEXT, TEXT, NUMERIC, INTEGER, NUMERIC, INTEGER) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.allocate_hot_wallet_nonce(INTEGER) TO service_role, postgres;

COMMIT;
