-- ============================================================================
-- Supabase Migration: 20261001030000_remove_testnet_and_unsupported_networks.sql
-- Description: Targeted Production-Only Network Remediation
--              1. Purges obsolete rows (SEPOLIA, POLYGON) from hot_wallet_nonces
--              2. Enforces strict check constraint on hot_wallet_nonces (ERC20, BEP20 only)
--              3. Hardens allocate_hot_wallet_nonce(TEXT, TEXT, BIGINT) to fail-closed on unknown networks
--              4. Hardens allocate_hot_wallet_nonce(INTEGER) to fail-closed on unknown chain IDs
--              5. Hardens legacy process_user_deposit RPC to fail-closed without testnet defaults
--              6. Locks execution grants to service_role and postgres only
-- ============================================================================

BEGIN;

-- 1. Cleanse hot_wallet_nonces of obsolete testnet and unsupported network rows
DELETE FROM public.hot_wallet_nonces 
WHERE UPPER(TRIM(network_code)) IN (
    'SEPOLIA', 'POLYGON', 'MATIC', 'ARBITRUM', 'BASE', 
    'MUMBAI', 'AMOY', 'GOERLI', 'HOLESKY', 'SHASTA', 'NILE'
);

-- 2. Add strict check constraint on hot_wallet_nonces
ALTER TABLE public.hot_wallet_nonces
    DROP CONSTRAINT IF EXISTS chk_hot_wallet_nonces_network;

ALTER TABLE public.hot_wallet_nonces
    ADD CONSTRAINT chk_hot_wallet_nonces_network
    CHECK (network_code IN ('ERC20', 'BEP20'));

-- 3. Hardened allocate_hot_wallet_nonce(p_network, p_wallet_address, p_onchain_pending_nonce)
-- Strictly fails closed on any non-production network. No MATIC -> POLYGON. No fallback.
CREATE OR REPLACE FUNCTION public.allocate_hot_wallet_nonce(
    p_network TEXT,
    p_wallet_address TEXT,
    p_onchain_pending_nonce BIGINT DEFAULT 0
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_norm_network TEXT := UPPER(TRIM(COALESCE(p_network, '')));
    v_current_nonce BIGINT;
BEGIN
    -- Map network aliases (Production EVM networks only)
    IF v_norm_network IN ('ETH', 'ETHEREUM', 'ERC20') THEN
        v_norm_network := 'ERC20';
    ELSIF v_norm_network IN ('BSC', 'BINANCE', 'BEP20') THEN
        v_norm_network := 'BEP20';
    ELSE
        RAISE EXCEPTION 'Unsupported network for hot wallet nonce allocation: %. Supported production networks: ERC20, BEP20', p_network;
    END IF;

    -- Lock the nonce record for this network
    SELECT current_nonce INTO v_current_nonce
    FROM public.hot_wallet_nonces
    WHERE network_code = v_norm_network
    FOR UPDATE;

    IF NOT FOUND THEN
        -- Initialize row for this network if not existing
        v_current_nonce := COALESCE(p_onchain_pending_nonce, 0);
        INSERT INTO public.hot_wallet_nonces (network_code, current_nonce, hot_wallet_address)
        VALUES (v_norm_network, v_current_nonce + 1, p_wallet_address);
        RETURN v_current_nonce;
    END IF;

    -- Reconcile with on-chain pending count if the on-chain pending count is higher
    IF p_onchain_pending_nonce > v_current_nonce THEN
        v_current_nonce := p_onchain_pending_nonce;
    END IF;

    -- Increment and save
    UPDATE public.hot_wallet_nonces
    SET current_nonce = v_current_nonce + 1,
        hot_wallet_address = COALESCE(NULLIF(p_wallet_address, ''), hot_wallet_address),
        updated_at = NOW()
    WHERE network_code = v_norm_network;

    RETURN v_current_nonce;
END;
$$;

-- 4. Hardened allocate_hot_wallet_nonce(p_chain_id INTEGER)
-- Strictly maps Chain ID 1 -> ERC20, Chain ID 56 -> BEP20. All other chain IDs fail closed.
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

    RETURN public.allocate_hot_wallet_nonce(v_net, COALESCE(v_hot_addr, '0x0000000000000000000000000000000000000000'), 0);
END;
$$;

-- 5. Hardened process_user_deposit RPC (Removes SEPOLIA default and fails closed)
CREATE OR REPLACE FUNCTION public.process_user_deposit(
    p_user_id UUID,
    p_address TEXT,
    p_asset TEXT,
    p_chain TEXT,
    p_amount NUMERIC,
    p_tx_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_norm_chain TEXT := UPPER(TRIM(COALESCE(p_chain, '')));
    v_norm_asset TEXT := UPPER(TRIM(COALESCE(p_asset, '')));
    v_canonical_network TEXT;
    v_expected_contract TEXT;
BEGIN
    -- Fail closed if chain is empty or null
    IF v_norm_chain = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'CHAIN_REQUIRED',
            'message', 'Chain parameter is required and must be one of: ERC20, BEP20, TRC20, BTC, LTC, ETH'
        );
    END IF;

    -- Explicitly reject testnets and unsupported networks
    IF v_norm_chain IN ('SEPOLIA', 'GOERLI', 'HOLESKY', 'MUMBAI', 'AMOY', 'SHASTA', 'NILE', 'TESTNET', 'TESTNET4', 'POLYGON', 'ARBITRUM', 'BASE', 'MATIC') THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'UNSUPPORTED_NETWORK',
            'message', 'Network ' || p_chain || ' is unsupported or disabled in production'
        );
    END IF;

    -- Map network aliases to canonical codes
    IF v_norm_chain IN ('ETH', 'ETHEREUM', 'ERC20') THEN
        v_canonical_network := 'ERC20';
        v_expected_contract := CASE WHEN v_norm_asset = 'USDT' THEN '0xdac17f958d2ee523a2206206994597c13d831ec7' ELSE NULL END;
    ELSIF v_norm_chain IN ('BSC', 'BINANCE', 'BEP20') THEN
        v_canonical_network := 'BEP20';
        v_expected_contract := CASE WHEN v_norm_asset = 'USDT' THEN '0x55d398326f99059ff775485246999027b3197955' ELSE NULL END;
    ELSIF v_norm_chain IN ('TRON', 'TRX', 'TRC20') THEN
        v_canonical_network := 'TRC20';
        v_expected_contract := CASE WHEN v_norm_asset = 'USDT' THEN 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' ELSE NULL END;
    ELSIF v_norm_chain IN ('BTC', 'BITCOIN') THEN
        v_canonical_network := 'BTC';
        v_expected_contract := NULL;
    ELSIF v_norm_chain IN ('LTC', 'LITECOIN') THEN
        v_canonical_network := 'LTC';
        v_expected_contract := NULL;
    ELSE
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVALID_NETWORK',
            'message', 'Invalid network: ' || p_chain
        );
    END IF;

    -- Forward to canonical process_deposit_atomic
    RETURN public.process_deposit_atomic(
        p_tx_hash := p_tx_hash,
        p_output_index := 0,
        p_network := v_canonical_network,
        p_address := p_address,
        p_amount := p_amount,
        p_asset := v_norm_asset,
        p_confirmations := 100,
        p_token_contract := v_expected_contract
    );
END;
$$;

-- 6. RPC Ambiguity Safety: Drop legacy 4-argument persist_signed_gas_funding to ensure single canonical 7-arg function with defaults
DROP FUNCTION IF EXISTS public.persist_signed_gas_funding(UUID, TEXT, TEXT, TEXT);

-- 7. Permissions Hardening
REVOKE EXECUTE ON FUNCTION public.allocate_hot_wallet_nonce(TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.allocate_hot_wallet_nonce(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_user_deposit(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.allocate_hot_wallet_nonce(TEXT, TEXT, BIGINT) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.allocate_hot_wallet_nonce(INTEGER) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.process_user_deposit(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT) TO service_role, postgres;

COMMIT;
