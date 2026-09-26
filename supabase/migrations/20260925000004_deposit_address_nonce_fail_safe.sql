-- ============================================================================
-- Supabase Migration: 20260925000004_deposit_address_nonce_fail_safe.sql
-- Description: Blocker #4 Fix - Atomic and Idempotent Nonce Allocator RPC
--              1. Adds EVM nonce column to public.sweep_operations
--              2. Implements allocate_deposit_address_nonce which atomically
--                 assigns, locks, and synchronizes deposit-address nonces.
--              3. Prevents any nonce gaps or concurrent collisions under crashes.
-- ============================================================================

BEGIN;

-- 1. Add nullable nonce column to sweep_operations if not exists
ALTER TABLE public.sweep_operations ADD COLUMN IF NOT EXISTS nonce BIGINT DEFAULT NULL;

-- 2. Create atomic, crash-safe nonce allocator function
CREATE OR REPLACE FUNCTION public.allocate_deposit_address_nonce(
    p_sweep_id UUID,
    p_worker_id TEXT,
    p_onchain_nonce BIGINT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sweep RECORD;
    v_row RECORD;
    v_net_code TEXT;
    v_effective_nonce BIGINT;
BEGIN
    -- 1. Lock and retrieve the sweep operation
    SELECT * INTO v_sweep
    FROM public.sweep_operations
    WHERE id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sweep operation not found';
    END IF;

    -- 2. Verify worker ownership
    IF v_sweep.worker_id IS DISTINCT FROM p_worker_id THEN
        RAISE EXCEPTION 'Worker ownership mismatch: Sweep belongs to another worker';
    END IF;

    -- 3. Verify valid pre-broadcast sweep status
    IF v_sweep.status NOT IN ('CLAIMED', 'GAS_FUNDING', 'GAS_FUNDED') THEN
        RAISE EXCEPTION 'Invalid sweep status: Nonce allocation only allowed in CLAIMED, GAS_FUNDING, or GAS_FUNDED states';
    END IF;

    -- 4. Idempotency Check: Return existing nonce if already allocated to this sweep
    IF v_sweep.nonce IS NOT NULL THEN
        RETURN v_sweep.nonce;
    END IF;

    -- 5. Validate on-chain nonce input
    IF p_onchain_nonce IS NULL OR p_onchain_nonce < 0 THEN
        RAISE EXCEPTION 'Invalid on-chain nonce: value must be a non-negative integer';
    END IF;

    -- 6. Normalize and validate network code from the sweep operation
    v_net_code := UPPER(TRIM(v_sweep.network));
    IF v_net_code NOT IN ('ETHEREUM', 'ERC20', 'BSC', 'BEP20') THEN
        RAISE EXCEPTION 'Unsupported EVM network code: %. Only ETHEREUM, ERC20, BSC, and BEP20 are supported', v_net_code;
    END IF;

    -- 7. Insert placeholder row in deposit_address_nonces if not exists to avoid Initial lock race conditions
    INSERT INTO public.deposit_address_nonces (deposit_address, network_code, current_nonce, updated_at)
    VALUES (v_sweep.deposit_address, v_net_code, p_onchain_nonce, NOW())
    ON CONFLICT (deposit_address) DO NOTHING;

    -- 8. Lock the deposit-address nonce row exclusively to serialize concurrent operations
    SELECT * INTO v_row
    FROM public.deposit_address_nonces
    WHERE deposit_address = v_sweep.deposit_address
    FOR UPDATE;

    -- 9. Enforce network consistency check
    IF v_row.network_code <> v_net_code THEN
        RAISE EXCEPTION 'Network code mismatch: Address is registered under %, requested %', v_row.network_code, v_net_code;
    END IF;

    -- 10. Compute effective nonce (Sync database to GREATEST value to prevent backward drifts)
    v_effective_nonce := GREATEST(v_row.current_nonce, p_onchain_nonce);

    -- 11. Save the next available nonce in deposit_address_nonces
    UPDATE public.deposit_address_nonces
    SET current_nonce = v_effective_nonce + 1,
        updated_at = NOW()
    WHERE deposit_address = v_sweep.deposit_address;

    -- 12. Save the allocated nonce in the sweep operation row
    UPDATE public.sweep_operations
    SET nonce = v_effective_nonce,
        updated_at = NOW()
    WHERE id = p_sweep_id;

    -- 13. Return the allocated nonce
    RETURN v_effective_nonce;
END;
$$;

-- 3. Security Hardening: Revoke PUBLIC / anon / authenticated permissions
REVOKE EXECUTE ON FUNCTION public.allocate_deposit_address_nonce(UUID, TEXT, BIGINT) FROM PUBLIC, anon, authenticated, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION public.allocate_deposit_address_nonce(UUID, TEXT, BIGINT) TO service_role, postgres;

COMMIT;
