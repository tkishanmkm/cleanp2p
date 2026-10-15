-- ============================================================================
-- Supabase Migration: 20261001040000_final_production_consistency_hardening.sql
-- Description: Final Production Schema & RPC Consistency Hardening
--              1. Hardens public.hot_wallet_nonces constraint on chain_id (1, 56)
--              2. Re-aligns allocate_hot_wallet_nonce(TEXT, TEXT, BIGINT) to live chain_id primary key schema
--              3. Re-aligns allocate_hot_wallet_nonce(INTEGER) to live chain_id primary key schema
--              4. Provides provision_user_wallets_atomic RPC for deterministic wallet derivation persistence
--              5. Restricts execution permissions on sensitive nonce & deposit RPCs to service_role and postgres
-- ============================================================================

BEGIN;

-- 1. Ensure hot_wallet_nonces table and chain_id constraint (Chain ID 1 = ERC20/ETH, Chain ID 56 = BEP20/BSC)
CREATE TABLE IF NOT EXISTS public.hot_wallet_nonces (
    chain_id INTEGER UNIQUE,
    network_code TEXT UNIQUE,
    current_nonce BIGINT NOT NULL DEFAULT 0,
    hot_wallet_address TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Earlier migrations created this table with network_code as its primary key.
-- Upgrade that legacy shape in place instead of assuming CREATE TABLE changed it.
ALTER TABLE public.hot_wallet_nonces ADD COLUMN IF NOT EXISTS chain_id INTEGER;
ALTER TABLE public.hot_wallet_nonces ADD COLUMN IF NOT EXISTS network_code TEXT;
ALTER TABLE public.hot_wallet_nonces ADD COLUMN IF NOT EXISTS hot_wallet_address TEXT;

UPDATE public.hot_wallet_nonces
SET chain_id = CASE UPPER(COALESCE(network_code, ''))
    WHEN 'ERC20' THEN 1 WHEN 'ETH' THEN 1 WHEN 'ETHEREUM' THEN 1
    WHEN 'BEP20' THEN 56 WHEN 'BSC' THEN 56 WHEN 'BINANCE' THEN 56
    ELSE chain_id
END
WHERE chain_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hot_wallet_nonces_chain_id
    ON public.hot_wallet_nonces (chain_id)
    WHERE chain_id IS NOT NULL;

ALTER TABLE public.hot_wallet_nonces
    DROP CONSTRAINT IF EXISTS chk_hot_wallet_nonces_network;

ALTER TABLE public.hot_wallet_nonces
    DROP CONSTRAINT IF EXISTS chk_hot_wallet_nonces_chain_id;

ALTER TABLE public.hot_wallet_nonces
    ADD CONSTRAINT chk_hot_wallet_nonces_chain_id
    CHECK (chain_id IN (1, 56));

-- 2. Hardened allocate_hot_wallet_nonce(p_network, p_wallet_address, p_onchain_pending_nonce)
-- Aligns with live schema using chain_id (1 for ERC20/ETH, 56 for BEP20/BSC)
CREATE OR REPLACE FUNCTION public.allocate_hot_wallet_nonce(
    p_network TEXT,
    p_wallet_address TEXT DEFAULT NULL,
    p_onchain_pending_nonce BIGINT DEFAULT 0
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_norm_network TEXT := UPPER(TRIM(COALESCE(p_network, '')));
    v_chain_id INTEGER;
    v_network_code TEXT;
    v_current_nonce BIGINT;
BEGIN
    IF v_norm_network IN ('ETH', 'ETHEREUM', 'ERC20') THEN
        v_chain_id := 1;
        v_network_code := 'ERC20';
    ELSIF v_norm_network IN ('BSC', 'BINANCE', 'BEP20') THEN
        v_chain_id := 56;
        v_network_code := 'BEP20';
    ELSE
        RAISE EXCEPTION 'Unsupported network for hot wallet nonce allocation: %. Supported production networks: ERC20 (Chain 1), BEP20 (Chain 56)', p_network;
    END IF;

    -- Initialize missing rows compatibly with both legacy and canonical schemas.
    -- The following row lock serializes allocators after first-use initialization.
    INSERT INTO public.hot_wallet_nonces
        (chain_id, network_code, current_nonce, hot_wallet_address, updated_at)
    VALUES (
        v_chain_id,
        v_network_code,
        COALESCE(p_onchain_pending_nonce, 0),
        COALESCE(NULLIF(p_wallet_address, ''), '0x0000000000000000000000000000000000000000'),
        NOW()
    )
    ON CONFLICT DO NOTHING;

    SELECT current_nonce INTO v_current_nonce
    FROM public.hot_wallet_nonces
    WHERE chain_id = v_chain_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unable to initialize nonce record for EVM chain %', v_chain_id;
    END IF;

    IF COALESCE(p_onchain_pending_nonce, 0) > v_current_nonce THEN
        v_current_nonce := p_onchain_pending_nonce;
    END IF;

    UPDATE public.hot_wallet_nonces
    SET current_nonce = v_current_nonce + 1,
        network_code = v_network_code,
        hot_wallet_address = COALESCE(
            NULLIF(p_wallet_address, ''),
            hot_wallet_address,
            '0x0000000000000000000000000000000000000000'
        ),
        updated_at = NOW()
    WHERE chain_id = v_chain_id;

    RETURN v_current_nonce;
END;
$$;

-- 3. Hardened allocate_hot_wallet_nonce(p_chain_id INTEGER)
-- Aligns directly with live schema using chain_id (1 or 56)
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
BEGIN
    IF p_chain_id = 1 THEN
        v_net := 'ERC20';
    ELSIF p_chain_id = 56 THEN
        v_net := 'BEP20';
    ELSE
        RAISE EXCEPTION 'Unsupported EVM chain ID for hot wallet nonce allocation: %. Supported: 1 (ERC20), 56 (BEP20)', p_chain_id;
    END IF;

    RETURN public.allocate_hot_wallet_nonce(v_net, NULL, 0);
END;
$$;

-- 4. Atomic provision_user_wallets_atomic RPC
CREATE OR REPLACE FUNCTION public.provision_user_wallets_atomic(
    p_user_id UUID,
    p_wallet_index INTEGER,
    p_evm_address TEXT,
    p_tron_address TEXT,
    p_btc_address TEXT,
    p_ltc_address TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- 1. Update profiles table with addresses
    UPDATE public.profiles
    SET wallet_index = COALESCE(wallet_index, p_wallet_index),
        evm_deposit_address = p_evm_address,
        tron_deposit_address = p_tron_address,
        btc_deposit_address = p_btc_address,
        ltc_deposit_address = p_ltc_address,
        updated_at = NOW()
    WHERE id = p_user_id;

    -- 2. Upsert user_deposit_addresses rows for 6 production networks
    INSERT INTO public.user_deposit_addresses (user_id, asset_symbol, chain, network, asset_code, network_code, address, derivation_path, created_at)
    VALUES
        (p_user_id, 'BTC', 'BTC', 'BTC', 'BTC', 'BTC', p_btc_address, 'm/84''/0''/0''/0/' || p_wallet_index::text, NOW()),
        (p_user_id, 'ETH', 'ETH', 'ETH', 'ETH', 'ETH', p_evm_address, 'm/44''/60''/0''/0/' || p_wallet_index::text, NOW()),
        (p_user_id, 'LTC', 'LTC', 'LTC', 'LTC', 'LTC', p_ltc_address, 'm/84''/2''/0''/0/' || p_wallet_index::text, NOW()),
        (p_user_id, 'USDT', 'ERC20', 'ERC20', 'USDT', 'ERC20', p_evm_address, 'm/44''/60''/0''/0/' || p_wallet_index::text, NOW()),
        (p_user_id, 'USDT', 'BEP20', 'BEP20', 'USDT', 'BEP20', p_evm_address, 'm/44''/60''/0''/0/' || p_wallet_index::text, NOW()),
        (p_user_id, 'USDT', 'TRC20', 'TRC20', 'USDT', 'TRC20', p_tron_address, 'm/44''/195''/0''/0/' || p_wallet_index::text, NOW())
    ON CONFLICT (address, network) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        derivation_path = EXCLUDED.derivation_path;

    -- 3. Ensure primary wallets table row exists
    INSERT INTO public.wallets (user_id, wallet_index, evm_address, tron_address, btc_address, ltc_address, status, created_at, updated_at)
    VALUES (p_user_id, p_wallet_index, p_evm_address, p_tron_address, p_btc_address, p_ltc_address, 'active', NOW(), NOW())
    ON CONFLICT (user_id) DO UPDATE
    SET evm_address = EXCLUDED.evm_address,
        tron_address = EXCLUDED.tron_address,
        btc_address = EXCLUDED.btc_address,
        ltc_address = EXCLUDED.ltc_address,
        updated_at = NOW();

    -- 4. Provision wallet_assets rows for user if missing
    INSERT INTO public.wallet_assets (user_id, asset_symbol, asset_code, balance, available, locked_balance, in_escrow, in_withdrawal, created_at, updated_at)
    VALUES
        (p_user_id, 'BTC', 'BTC', 0, 0, 0, 0, 0, NOW(), NOW()),
        (p_user_id, 'ETH', 'ETH', 0, 0, 0, 0, 0, NOW(), NOW()),
        (p_user_id, 'LTC', 'LTC', 0, 0, 0, 0, 0, NOW(), NOW()),
        (p_user_id, 'USDT', 'USDT', 0, 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT (user_id, asset_symbol) DO NOTHING;

    RETURN jsonb_build_object('success', true, 'user_id', p_user_id, 'wallet_index', p_wallet_index);
END;
$$;

-- 5. Permissions Hardening
REVOKE EXECUTE ON FUNCTION public.allocate_hot_wallet_nonce(TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.allocate_hot_wallet_nonce(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_user_deposit(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.provision_user_wallets_atomic(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.allocate_hot_wallet_nonce(TEXT, TEXT, BIGINT) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.allocate_hot_wallet_nonce(INTEGER) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.process_user_deposit(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.provision_user_wallets_atomic(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT) TO service_role, postgres;

COMMIT;
