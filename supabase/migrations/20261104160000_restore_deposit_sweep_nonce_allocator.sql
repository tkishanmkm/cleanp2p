-- Restore the service-only EVM deposit-sweep nonce allocator.
-- Serializes nonce assignment per deposit address and blocks later nonces while
-- an earlier sweep for that address remains unresolved.

BEGIN;

-- EVM accounts may intentionally reuse the same 0x address on Ethereum
-- and BNB Smart Chain. Nonce counters are chain-specific, not address-only.
-- No foreign keys reference this registry (verified against the live schema).
ALTER TABLE public.deposit_address_nonces
    DROP CONSTRAINT IF EXISTS deposit_address_nonces_pkey;
ALTER TABLE public.deposit_address_nonces
    ADD CONSTRAINT deposit_address_nonces_pkey
    PRIMARY KEY (deposit_address, network_code);

-- Prevent the same derived EVM account from owning duplicate nonces on
-- the same chain, while allowing the same 0x address to use independent
-- nonce spaces on Ethereum and BNB Smart Chain.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sweep_operations_evm_deposit_nonce
    ON public.sweep_operations (
        pg_catalog.lower(deposit_address),
        (CASE upper(pg_catalog.btrim(network))
            WHEN 'ETH' THEN 'ERC20'
            WHEN 'ETHEREUM' THEN 'ERC20'
            WHEN 'ERC20' THEN 'ERC20'
            WHEN 'BSC' THEN 'BEP20'
            WHEN 'BINANCE' THEN 'BEP20'
            WHEN 'BEP20' THEN 'BEP20'
            ELSE upper(pg_catalog.btrim(network))
        END),
        nonce
    )
    WHERE nonce IS NOT NULL
      AND upper(pg_catalog.btrim(network)) IN ('ETH', 'ETHEREUM', 'ERC20', 'BSC', 'BINANCE', 'BEP20');

CREATE INDEX IF NOT EXISTS idx_sweep_operations_unresolved_deposit_nonce
    ON public.sweep_operations (
        pg_catalog.lower(deposit_address),
        (CASE upper(pg_catalog.btrim(network))
            WHEN 'ETH' THEN 'ERC20'
            WHEN 'ETHEREUM' THEN 'ERC20'
            WHEN 'ERC20' THEN 'ERC20'
            WHEN 'BSC' THEN 'BEP20'
            WHEN 'BINANCE' THEN 'BEP20'
            WHEN 'BEP20' THEN 'BEP20'
            ELSE upper(pg_catalog.btrim(network))
        END),
        nonce
    )
    WHERE nonce IS NOT NULL
      AND status NOT IN ('CONFIRMED', 'FAILED');

CREATE OR REPLACE FUNCTION public.allocate_deposit_address_nonce(
    p_sweep_id UUID,
    p_worker_id TEXT,
    p_onchain_nonce BIGINT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_sweep public.sweep_operations%ROWTYPE;
    v_nonce_row public.deposit_address_nonces%ROWTYPE;
    v_network_code TEXT;
    v_registry_address TEXT;
    v_effective_nonce BIGINT;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Service role required for deposit-address nonce allocation'
            USING ERRCODE = '42501';
    END IF;

    IF p_sweep_id IS NULL
       OR p_worker_id IS NULL
       OR pg_catalog.btrim(p_worker_id) = ''
       OR length(p_worker_id) > 128
       OR p_onchain_nonce IS NULL
       OR p_onchain_nonce < 0 THEN
        RAISE EXCEPTION 'Invalid deposit-address nonce allocation payload'
            USING ERRCODE = '22023';
    END IF;

    SELECT *
      INTO v_sweep
    FROM public.sweep_operations
    WHERE id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_sweep.worker_id IS DISTINCT FROM p_worker_id
       OR v_sweep.lease_expires_at IS NULL
       OR v_sweep.lease_expires_at <= pg_catalog.clock_timestamp() THEN
        RAISE EXCEPTION 'Active sweep worker lease is required for nonce allocation'
            USING ERRCODE = '42501';
    END IF;

    IF upper(coalesce(v_sweep.status, '')) NOT IN ('CLAIMED', 'GAS_FUNDING', 'GAS_FUNDED') THEN
        RAISE EXCEPTION 'Nonce allocation is not allowed in sweep state %', v_sweep.status
            USING ERRCODE = '55000';
    END IF;

    v_network_code := CASE upper(pg_catalog.btrim(coalesce(v_sweep.network, '')))
        WHEN 'ETH' THEN 'ERC20'
        WHEN 'ETHEREUM' THEN 'ERC20'
        WHEN 'ERC20' THEN 'ERC20'
        WHEN 'BSC' THEN 'BEP20'
        WHEN 'BINANCE' THEN 'BEP20'
        WHEN 'BEP20' THEN 'BEP20'
        ELSE NULL
    END;

    IF v_network_code IS NULL
       OR nullif(pg_catalog.btrim(coalesce(v_sweep.deposit_address, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Unsupported EVM sweep network or missing deposit address'
            USING ERRCODE = '22023';
    END IF;

    -- EVM addresses are case-insensitive. Normalize the registry identity so
    -- checksum casing cannot create a second nonce sequence for the same key.
    v_registry_address := pg_catalog.lower(pg_catalog.btrim(v_sweep.deposit_address));

    -- The composite address/network key serializes sweeps on the same chain;
    -- the same 0x address on another EVM chain has an independent nonce space.
    INSERT INTO public.deposit_address_nonces (
        deposit_address, network_code, current_nonce, updated_at
    )
    VALUES (
        v_registry_address, v_network_code, p_onchain_nonce, pg_catalog.clock_timestamp()
    )
    ON CONFLICT (deposit_address, network_code) DO NOTHING;

    SELECT *
      INTO v_nonce_row
    FROM public.deposit_address_nonces
    WHERE deposit_address = v_registry_address
      AND network_code = v_network_code
    FOR UPDATE;

    IF NOT FOUND OR v_nonce_row.network_code IS DISTINCT FROM v_network_code THEN
        RAISE EXCEPTION 'Deposit address nonce registry network mismatch'
            USING ERRCODE = '23514';
    END IF;

    -- An existing nonce is an idempotent retry only after its chain/address
    -- namespace is locked and the shared counter is advanced beyond it. This
    -- also repairs a stale registry counter without assigning a second nonce.
    IF v_sweep.nonce IS NOT NULL THEN
        IF v_sweep.nonce < 0 OR v_sweep.nonce = 9223372036854775807 THEN
            RAISE EXCEPTION 'Existing sweep nonce is outside the allocatable range'
                USING ERRCODE = '22003';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM public.sweep_operations AS prior
            WHERE prior.id <> p_sweep_id
              AND pg_catalog.lower(prior.deposit_address) = pg_catalog.lower(v_sweep.deposit_address)
              AND CASE upper(pg_catalog.btrim(coalesce(prior.network, '')))
                    WHEN 'ETH' THEN 'ERC20'
                    WHEN 'ETHEREUM' THEN 'ERC20'
                    WHEN 'ERC20' THEN 'ERC20'
                    WHEN 'BSC' THEN 'BEP20'
                    WHEN 'BINANCE' THEN 'BEP20'
                    WHEN 'BEP20' THEN 'BEP20'
                    ELSE NULL
                  END = v_network_code
              AND prior.nonce = v_sweep.nonce
        ) THEN
            RAISE EXCEPTION 'Existing sweep nonce is already attached to another sweep for this EVM account and chain'
                USING ERRCODE = '23505';
        END IF;

        UPDATE public.deposit_address_nonces
        SET current_nonce = GREATEST(current_nonce, v_sweep.nonce + 1),
            updated_at = pg_catalog.clock_timestamp()
        WHERE deposit_address = v_registry_address
          AND network_code = v_network_code;

        RETURN v_sweep.nonce;
    END IF;

    -- Do not allocate N+1 while a previous sweep on this address still owns an
    -- unresolved nonce. The prior worker must reconcile the same persisted tx.
    IF EXISTS (
        SELECT 1
        FROM public.sweep_operations AS prior
        WHERE pg_catalog.lower(prior.deposit_address) = v_registry_address
          AND prior.id <> p_sweep_id
          AND prior.nonce IS NOT NULL
          AND upper(coalesce(prior.network, '')) IN (
              CASE WHEN v_network_code = 'ERC20' THEN 'ERC20' ELSE 'BEP20' END,
              CASE WHEN v_network_code = 'ERC20' THEN 'ETH' ELSE 'BSC' END,
              CASE WHEN v_network_code = 'ERC20' THEN 'ETHEREUM' ELSE 'BINANCE' END
          )
          AND upper(coalesce(prior.status, '')) NOT IN ('CONFIRMED', 'FAILED')
    ) THEN
        RAISE EXCEPTION 'An earlier sweep for this deposit address still has an unresolved nonce; reconcile it before allocating another'
            USING ERRCODE = '55P03';
    END IF;

    v_effective_nonce := GREATEST(v_nonce_row.current_nonce, p_onchain_nonce);
    IF v_effective_nonce < 0 OR v_effective_nonce >= 9223372036854775807 THEN
        RAISE EXCEPTION 'EVM deposit-address nonce counter is outside the allocatable range'
            USING ERRCODE = '22003';
    END IF;

    UPDATE public.deposit_address_nonces
    SET current_nonce = v_effective_nonce + 1,
        updated_at = pg_catalog.clock_timestamp()
    WHERE deposit_address = v_registry_address
      AND network_code = v_network_code;

    UPDATE public.sweep_operations
    SET nonce = v_effective_nonce,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = p_sweep_id
      AND worker_id = p_worker_id
      AND nonce IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Could not persist allocated nonce on the owned sweep'
            USING ERRCODE = '55000';
    END IF;

    RETURN v_effective_nonce;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_deposit_address_nonce(UUID, TEXT, BIGINT)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.allocate_deposit_address_nonce(UUID, TEXT, BIGINT)
    TO service_role, postgres;

COMMENT ON FUNCTION public.allocate_deposit_address_nonce(UUID, TEXT, BIGINT) IS
    'Service-only, per-deposit-address EVM nonce allocator. Existing sweep nonce is idempotent; later sweeps wait for earlier nonce reconciliation.';

COMMIT;
