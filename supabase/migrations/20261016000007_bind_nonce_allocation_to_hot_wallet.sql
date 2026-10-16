-- Prevent a single network nonce counter from being silently reused by a different hot-wallet address.
-- This migration is source-only until reviewed and applied through the normal staging process.
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
    v_norm_network TEXT := UPPER(TRIM(p_network));
    v_current_nonce BIGINT;
    v_allocated_nonce BIGINT;
    v_hot_wallet_address TEXT;
BEGIN
    IF v_norm_network IN ('ETH', 'ETHEREUM') THEN
        v_norm_network := 'ERC20';
    ELSIF v_norm_network IN ('BSC', 'BINANCE') THEN
        v_norm_network := 'BEP20';
    ELSIF v_norm_network IN ('MATIC') THEN
        v_norm_network := 'POLYGON';
    END IF;

    IF v_norm_network NOT IN ('ERC20', 'BEP20', 'POLYGON')
       OR NULLIF(TRIM(p_wallet_address), '') IS NULL
       OR p_onchain_pending_nonce IS NULL
       OR p_onchain_pending_nonce < 0 THEN
        RAISE EXCEPTION 'Invalid network, hot-wallet address, or pending nonce';
    END IF;

    SELECT current_nonce, hot_wallet_address
      INTO v_current_nonce, v_hot_wallet_address
      FROM public.hot_wallet_nonces
     WHERE network_code = v_norm_network
     FOR UPDATE;

    IF NOT FOUND THEN
        v_current_nonce := p_onchain_pending_nonce;
        INSERT INTO public.hot_wallet_nonces (network_code, current_nonce, hot_wallet_address)
        VALUES (v_norm_network, v_current_nonce + 1, TRIM(p_wallet_address));
        RETURN v_current_nonce;
    END IF;

    -- Existing migrations seed placeholder zero addresses; bind those once to the
    -- trusted server-configured wallet, but never silently switch a real wallet.
    IF LOWER(TRIM(COALESCE(v_hot_wallet_address, ''))) = '0x0000000000000000000000000000000000000000' THEN
        UPDATE public.hot_wallet_nonces
           SET hot_wallet_address = TRIM(p_wallet_address),
               updated_at = NOW()
         WHERE network_code = v_norm_network;
    ELSIF NULLIF(TRIM(v_hot_wallet_address), '') IS NULL
       OR LOWER(TRIM(v_hot_wallet_address)) <> LOWER(TRIM(p_wallet_address)) THEN
        RAISE EXCEPTION 'Configured hot-wallet address mismatch for network %', v_norm_network;
    END IF;

    IF p_onchain_pending_nonce > v_current_nonce THEN
        v_current_nonce := p_onchain_pending_nonce;
    END IF;

    IF v_current_nonce >= 9223372036854775807 THEN
        RAISE EXCEPTION 'Hot-wallet nonce counter exhausted';
    END IF;

    v_allocated_nonce := v_current_nonce;

    UPDATE public.hot_wallet_nonces
       SET current_nonce = v_allocated_nonce + 1,
           hot_wallet_address = TRIM(p_wallet_address),
           updated_at = NOW()
     WHERE network_code = v_norm_network;

    RETURN v_allocated_nonce;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_hot_wallet_nonce(TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_hot_wallet_nonce(TEXT, TEXT, BIGINT) TO service_role, postgres;
