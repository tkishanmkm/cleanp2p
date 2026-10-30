-- Paxones wallet provisioning invariant hardening.
-- This migration is intentionally additive and does not modify existing wallet balances.
BEGIN;

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
DECLARE
    v_profile_index INTEGER;
    v_profile_found BOOLEAN := FALSE;
    v_collision BOOLEAN := FALSE;
BEGIN
    IF p_user_id IS NULL OR p_wallet_index IS NULL OR p_wallet_index <= 0 THEN
        RAISE EXCEPTION 'Invalid user or wallet index';
    END IF;

    IF NULLIF(BTRIM(p_evm_address), '') IS NULL
       OR NULLIF(BTRIM(p_tron_address), '') IS NULL
       OR NULLIF(BTRIM(p_btc_address), '') IS NULL
       OR NULLIF(BTRIM(p_ltc_address), '') IS NULL THEN
        RAISE EXCEPTION 'All wallet addresses are required';
    END IF;

    -- Lock the profile and require the server-supplied index to match the
    -- already allocated index. Never silently overwrite an index/address set.
    SELECT wallet_index, TRUE
      INTO v_profile_index, v_profile_found
      FROM public.profiles
     WHERE id = p_user_id
     FOR UPDATE;

    IF NOT COALESCE(v_profile_found, FALSE) THEN
        RAISE EXCEPTION 'Profile not found for wallet provisioning';
    END IF;

    IF v_profile_index IS NULL OR v_profile_index <= 0 OR v_profile_index <> p_wallet_index THEN
        RAISE EXCEPTION 'Wallet index mismatch; refusing to provision';
    END IF;

    -- Do not allow an address already assigned to another account to be
    -- reassigned by the previous ON CONFLICT DO UPDATE user_id behavior.
    SELECT EXISTS (
      SELECT 1
        FROM public.user_deposit_addresses existing
        JOIN (VALUES
          ('BTC'::TEXT, BTRIM(p_btc_address)),
          ('ETH'::TEXT, LOWER(BTRIM(p_evm_address))),
          ('ERC20'::TEXT, LOWER(BTRIM(p_evm_address))),
          ('BEP20'::TEXT, LOWER(BTRIM(p_evm_address))),
          ('LTC'::TEXT, BTRIM(p_ltc_address)),
          ('TRC20'::TEXT, BTRIM(p_tron_address))
        ) incoming(network, address)
          ON UPPER(BTRIM(existing.network)) = incoming.network
         AND (CASE WHEN incoming.network IN ('ETH','ERC20','BEP20')
                   THEN LOWER(BTRIM(existing.address))
                   ELSE BTRIM(existing.address) END) = incoming.address
       WHERE existing.user_id <> p_user_id
    ) INTO v_collision;

    IF v_collision THEN
        RAISE EXCEPTION 'A deposit address is already assigned to another user';
    END IF;

    UPDATE public.profiles
       SET evm_deposit_address = p_evm_address,
           tron_deposit_address = p_tron_address,
           btc_deposit_address = p_btc_address,
           ltc_deposit_address = p_ltc_address,
           updated_at = NOW()
     WHERE id = p_user_id;

    INSERT INTO public.user_deposit_addresses
      (user_id, asset_symbol, chain, network, asset_code, network_code, address, derivation_path, created_at)
    VALUES
      (p_user_id, 'BTC', 'BTC', 'BTC', 'BTC', 'BTC', p_btc_address, 'm/84''/0''/0''/0/' || p_wallet_index::text, NOW()),
      (p_user_id, 'ETH', 'ETH', 'ETH', 'ETH', 'ETH', p_evm_address, 'm/44''/60''/0''/0/' || p_wallet_index::text, NOW()),
      (p_user_id, 'LTC', 'LTC', 'LTC', 'LTC', 'LTC', p_ltc_address, 'm/84''/2''/0''/0/' || p_wallet_index::text, NOW()),
      (p_user_id, 'USDT', 'ERC20', 'ERC20', 'USDT', 'ERC20', p_evm_address, 'm/44''/60''/0''/0/' || p_wallet_index::text, NOW()),
      (p_user_id, 'USDT', 'BEP20', 'BEP20', 'USDT', 'BEP20', p_evm_address, 'm/44''/60''/0''/0/' || p_wallet_index::text, NOW()),
      (p_user_id, 'USDT', 'TRC20', 'TRC20', 'USDT', 'TRC20', p_tron_address, 'm/44''/195''/0''/0/' || p_wallet_index::text, NOW())
    ON CONFLICT (address, network) DO UPDATE
       SET derivation_path = EXCLUDED.derivation_path
     WHERE user_deposit_addresses.user_id = EXCLUDED.user_id;

    INSERT INTO public.wallets
      (user_id, wallet_index, evm_address, tron_address, btc_address, ltc_address, status, created_at, updated_at)
    VALUES
      (p_user_id, p_wallet_index, p_evm_address, p_tron_address, p_btc_address, p_ltc_address, 'active', NOW(), NOW())
    ON CONFLICT (user_id) DO UPDATE
       SET wallet_index = EXCLUDED.wallet_index,
           evm_address = EXCLUDED.evm_address,
           tron_address = EXCLUDED.tron_address,
           btc_address = EXCLUDED.btc_address,
           ltc_address = EXCLUDED.ltc_address,
           updated_at = NOW()
     WHERE wallets.wallet_index = EXCLUDED.wallet_index;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Existing wallet index mismatch; refusing to overwrite wallet';
    END IF;

    INSERT INTO public.wallet_assets
      (user_id, asset_symbol, asset_code, balance, available, locked_balance, in_escrow, in_withdrawal, created_at, updated_at)
    VALUES
      (p_user_id, 'BTC', 'BTC', 0, 0, 0, 0, 0, NOW(), NOW()),
      (p_user_id, 'ETH', 'ETH', 0, 0, 0, 0, 0, NOW(), NOW()),
      (p_user_id, 'LTC', 'LTC', 0, 0, 0, 0, 0, NOW(), NOW()),
      (p_user_id, 'USDT', 'USDT', 0, 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT (user_id, asset_symbol) DO NOTHING;

    RETURN jsonb_build_object('success', true, 'user_id', p_user_id, 'wallet_index', p_wallet_index);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.provision_user_wallets_atomic(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_user_wallets_atomic(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT) TO service_role, postgres;

COMMIT;
