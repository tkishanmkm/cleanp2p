-- Pending-only deposit registration. This function must never mutate wallet balances or ledger entries.
-- It is intentionally separate from process_deposit_atomic so ingress cannot credit funds.
-- Keep function creation and privilege changes atomic: CREATE FUNCTION grants EXECUTE to PUBLIC by default.
BEGIN;

CREATE OR REPLACE FUNCTION public.register_pending_deposit(
    p_destination_address text,
    p_asset_symbol text,
    p_network_code text,
    p_amount numeric,
    p_tx_hash text,
    p_output_index integer DEFAULT 0,
    p_block_number bigint DEFAULT NULL,
    p_from_address text DEFAULT NULL,
    p_token_contract text DEFAULT NULL,
    p_confirmations integer DEFAULT 0,
    p_provider text DEFAULT 'internal'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_network text := upper(btrim(coalesce(p_network_code, '')));
    v_asset text := upper(btrim(coalesce(p_asset_symbol, '')));
    v_hash text := lower(btrim(coalesce(p_tx_hash, '')));
    v_address text;
    v_contract text;
    v_expected_asset text;
    v_expected_contract text;
    v_required integer;
    v_user_id uuid;
    v_owner_count integer;
    v_existing_deposit public.deposits%ROWTYPE;
    v_existing_onchain public.onchain_deposits%ROWTYPE;
    v_deposit_id uuid;
    v_onchain_id uuid;
BEGIN
    IF nullif(btrim(coalesce(p_destination_address, '')), '') IS NULL
       OR v_asset = '' OR v_network = '' OR v_hash = ''
       OR p_amount IS NULL OR p_amount <= 0
       OR p_output_index IS NULL OR p_output_index < 0
       OR p_confirmations IS DISTINCT FROM 0 THEN
        RETURN jsonb_build_object('success', false, 'credited', false, 'code', 'INVALID_PENDING_DEPOSIT_INPUT');
    END IF;

    CASE v_network
      WHEN 'BTC' THEN v_expected_asset := 'BTC'; v_required := 3; v_expected_contract := NULL;
      WHEN 'LTC' THEN v_expected_asset := 'LTC'; v_required := 12; v_expected_contract := NULL;
      WHEN 'ETH' THEN v_expected_asset := 'ETH'; v_required := 12; v_expected_contract := NULL;
      WHEN 'ERC20' THEN v_expected_asset := 'USDT'; v_required := 12; v_expected_contract := '0xdac17f958d2ee523a2206206994597c13d831ec7';
      WHEN 'BEP20' THEN v_expected_asset := 'USDT'; v_required := 15; v_expected_contract := '0x55d398326f99059ff775485246999027b3197955';
      WHEN 'TRC20' THEN v_expected_asset := 'USDT'; v_required := 19; v_expected_contract := 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
      ELSE RETURN jsonb_build_object('success', false, 'credited', false, 'code', 'UNSUPPORTED_NETWORK');
    END CASE;

    IF v_asset IS DISTINCT FROM v_expected_asset THEN
      RETURN jsonb_build_object('success', false, 'credited', false, 'code', 'ASSET_NETWORK_MISMATCH');
    END IF;

    v_address := btrim(p_destination_address);
    IF v_network IN ('ETH', 'ERC20', 'BEP20') THEN v_address := lower(v_address); END IF;

    IF v_expected_contract IS NULL THEN
      IF nullif(btrim(coalesce(p_token_contract, '')), '') IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'credited', false, 'code', 'UNEXPECTED_TOKEN_CONTRACT');
      END IF;
      v_contract := NULL;
    ELSE
      v_contract := lower(btrim(coalesce(p_token_contract, '')));
      IF v_network = 'TRC20' THEN v_contract := btrim(coalesce(p_token_contract, '')); END IF;
      IF v_contract IS DISTINCT FROM v_expected_contract THEN
        RETURN jsonb_build_object('success', false, 'credited', false, 'code', 'INVALID_TOKEN_CONTRACT');
      END IF;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('deposit:' || v_network || ':' || v_hash || ':' || p_output_index::text));

    -- Resolve ownership across every registered address source in one query.
    -- UNION deduplicates the same user registered in multiple sources while still
    -- rejecting an address that is assigned to two different accounts.
    SELECT COUNT(*), MIN(owner_id::text)::uuid
      INTO v_owner_count, v_user_id
      FROM (
        SELECT uda.user_id AS owner_id
          FROM public.user_deposit_addresses AS uda
         WHERE (CASE WHEN v_network IN ('ETH','ERC20','BEP20')
                     THEN LOWER(BTRIM(uda.address)) = v_address
                     ELSE BTRIM(uda.address) = v_address END)
           AND (
             (v_network = 'BTC' AND (
               UPPER(BTRIM(COALESCE(uda.network_code,''))) IN ('BTC','BITCOIN')
               OR LOWER(BTRIM(uda.network::text)) = 'bitcoin'
               OR LOWER(BTRIM(COALESCE(uda.chain,''))) = 'bitcoin'
             ))
             OR (v_network = 'LTC' AND (
               UPPER(BTRIM(COALESCE(uda.network_code,''))) IN ('LTC','LITECOIN')
               OR LOWER(BTRIM(uda.network::text)) = 'litecoin'
               OR LOWER(BTRIM(COALESCE(uda.chain,''))) = 'litecoin'
             ))
             OR (v_network = 'ETH' AND (
               UPPER(BTRIM(COALESCE(uda.network_code,''))) IN ('ETH','ETHEREUM')
               OR LOWER(BTRIM(uda.network::text)) = 'ethereum'
               OR LOWER(BTRIM(COALESCE(uda.chain,''))) = 'ethereum'
             ))
             OR (v_network = 'ERC20' AND (
               UPPER(BTRIM(COALESCE(uda.network_code,''))) IN ('ERC20','ETH','ETHEREUM')
               OR UPPER(BTRIM(uda.network::text)) IN ('ERC20','ETH','ETHEREUM')
               OR UPPER(BTRIM(COALESCE(uda.chain,''))) IN ('ERC20','ETH','ETHEREUM')
             ) AND UPPER(COALESCE(NULLIF(BTRIM(uda.asset_code),''),NULLIF(BTRIM(uda.asset_symbol),''),'')) = 'USDT')
             OR (v_network = 'BEP20' AND (
               UPPER(BTRIM(COALESCE(uda.network_code,''))) IN ('BEP20','BSC','BINANCE')
               OR UPPER(BTRIM(uda.network::text)) IN ('BEP20','BSC','BINANCE')
               OR UPPER(BTRIM(COALESCE(uda.chain,''))) IN ('BEP20','BSC','BINANCE')
             ) AND UPPER(COALESCE(NULLIF(BTRIM(uda.asset_code),''),NULLIF(BTRIM(uda.asset_symbol),''),'')) = 'USDT')
             OR (v_network = 'TRC20' AND (
               UPPER(BTRIM(COALESCE(uda.network_code,''))) IN ('TRC20','TRON')
               OR UPPER(BTRIM(uda.network::text)) IN ('TRC20','TRON')
               OR UPPER(BTRIM(COALESCE(uda.chain,''))) IN ('TRC20','TRON')
             ))
           )
        UNION
        SELECT w.user_id AS owner_id
          FROM public.wallets AS w
         WHERE (CASE WHEN v_network IN ('ETH','ERC20','BEP20')
                     THEN LOWER(BTRIM(w.address)) = v_address
                     ELSE BTRIM(w.address) = v_address END)
           AND UPPER(COALESCE(w.funding_status,'')) = 'ACTIVE'
           AND (
             (v_network IN ('ETH','ERC20','BEP20') AND UPPER(BTRIM(w.chain)) = 'EVM')
             OR (v_network = 'BTC' AND UPPER(BTRIM(w.chain)) IN ('BTC','BITCOIN'))
             OR (v_network = 'LTC' AND UPPER(BTRIM(w.chain)) IN ('LTC','LITECOIN'))
             OR (v_network = 'TRC20' AND UPPER(BTRIM(w.chain)) IN ('TRON','TRC20'))
           )
        UNION
        SELECT da.user_id AS owner_id
          FROM public.deposit_addresses AS da
         WHERE (CASE WHEN v_network IN ('ETH','ERC20','BEP20')
                     THEN LOWER(BTRIM(da.address)) = v_address
                     ELSE BTRIM(da.address) = v_address END)
           AND da.is_active IS TRUE
           AND LOWER(BTRIM(COALESCE(da.status,''))) = 'active'
           AND UPPER(COALESCE(NULLIF(BTRIM(da.asset_code),''),NULLIF(BTRIM(da.asset_symbol),''),NULLIF(BTRIM(da.crypto),''),NULLIF(BTRIM(da.asset),''),'')) = v_asset
           AND (
             (v_network = 'BTC' AND (
               UPPER(BTRIM(COALESCE(da.network_code,''))) IN ('BTC','BITCOIN')
               OR LOWER(BTRIM(COALESCE(da.network,''))) = 'bitcoin'
               OR LOWER(BTRIM(COALESCE(da.chain,''))) = 'bitcoin'
             ))
             OR (v_network = 'LTC' AND (
               UPPER(BTRIM(COALESCE(da.network_code,''))) IN ('LTC','LITECOIN')
               OR LOWER(BTRIM(COALESCE(da.network,''))) = 'litecoin'
               OR LOWER(BTRIM(COALESCE(da.chain,''))) = 'litecoin'
             ))
             OR (v_network = 'ETH' AND (
               UPPER(BTRIM(COALESCE(da.network_code,''))) IN ('ETH','ETHEREUM')
               OR LOWER(BTRIM(COALESCE(da.network,''))) = 'ethereum'
               OR LOWER(BTRIM(COALESCE(da.chain,''))) = 'ethereum'
             ))
             OR (v_network = 'ERC20' AND (
               UPPER(BTRIM(COALESCE(da.network_code,''))) IN ('ERC20','ETH','ETHEREUM')
               OR UPPER(BTRIM(COALESCE(da.network,''))) IN ('ERC20','ETH','ETHEREUM')
               OR UPPER(BTRIM(COALESCE(da.chain,''))) IN ('ERC20','ETH','ETHEREUM')
             ))
             OR (v_network = 'BEP20' AND (
               UPPER(BTRIM(COALESCE(da.network_code,''))) IN ('BEP20','BSC','BINANCE')
               OR UPPER(BTRIM(COALESCE(da.network,''))) IN ('BEP20','BSC','BINANCE')
               OR UPPER(BTRIM(COALESCE(da.chain,''))) IN ('BEP20','BSC','BINANCE')
             ))
             OR (v_network = 'TRC20' AND (
               UPPER(BTRIM(COALESCE(da.network_code,''))) IN ('TRC20','TRON')
               OR UPPER(BTRIM(COALESCE(da.network,''))) IN ('TRC20','TRON')
               OR UPPER(BTRIM(COALESCE(da.chain,''))) IN ('TRC20','TRON')
             ))
           )
      ) AS deposit_address_owners;

    IF coalesce(v_owner_count, 0) <> 1 OR v_user_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'credited', false,
        'code', CASE WHEN coalesce(v_owner_count,0) > 1 THEN 'AMBIGUOUS_ADDRESS_OWNER' ELSE 'ADDRESS_NOT_FOUND' END);
    END IF;

    SELECT * INTO v_existing_deposit FROM public.deposits
      WHERE lower(btrim(tx_hash)) = v_hash AND upper(btrim(chain)) = v_network AND output_index = p_output_index
      FOR UPDATE;
    SELECT * INTO v_existing_onchain FROM public.onchain_deposits
      WHERE lower(btrim(tx_hash)) = v_hash AND upper(btrim(network)) = v_network AND output_index = p_output_index
      FOR UPDATE;

    IF v_existing_deposit.id IS NOT NULL AND (
      v_existing_deposit.user_id IS DISTINCT FROM v_user_id OR v_existing_deposit.amount IS DISTINCT FROM p_amount
      OR upper(btrim(v_existing_deposit.token_symbol)) IS DISTINCT FROM v_asset
      OR upper(btrim(v_existing_deposit.asset)) IS DISTINCT FROM v_asset
      OR v_existing_deposit.output_index IS DISTINCT FROM p_output_index
      OR (CASE WHEN v_network IN ('ETH','ERC20','BEP20') THEN lower(btrim(v_existing_deposit.to_address)) ELSE btrim(v_existing_deposit.to_address) END) IS DISTINCT FROM v_address
    ) THEN
      RETURN jsonb_build_object('success', false, 'credited', false, 'code', 'EXISTING_DEPOSIT_IDENTITY_MISMATCH');
    END IF;

    IF v_existing_onchain.id IS NOT NULL AND (
      v_existing_onchain.user_id IS DISTINCT FROM v_user_id OR v_existing_onchain.amount IS DISTINCT FROM p_amount
      OR upper(btrim(v_existing_onchain.network)) IS DISTINCT FROM v_network
      OR upper(btrim(v_existing_onchain.asset_symbol)) IS DISTINCT FROM v_asset
      OR upper(btrim(v_existing_onchain.asset)) IS DISTINCT FROM v_asset
      OR v_existing_onchain.output_index IS DISTINCT FROM p_output_index
      OR (CASE WHEN v_network IN ('ETH','ERC20','BEP20') THEN lower(btrim(coalesce(v_existing_onchain.to_address,v_existing_onchain.address))) ELSE btrim(coalesce(v_existing_onchain.to_address,v_existing_onchain.address)) END) IS DISTINCT FROM v_address
    ) THEN
      RETURN jsonb_build_object('success', false, 'credited', false, 'code', 'EXISTING_ONCHAIN_IDENTITY_MISMATCH');
    END IF;

    -- Never relabel a previously credited output as pending. A terminal state in
    -- only one registry is inconsistent and must be reconciled instead of retried.
    IF (v_existing_deposit.id IS NOT NULL AND upper(btrim(coalesce(v_existing_deposit.status, ''))) = 'CONFIRMED')
       OR (v_existing_onchain.id IS NOT NULL AND upper(btrim(coalesce(v_existing_onchain.status, ''))) IN ('CONFIRMED', 'CREDITED')) THEN
      IF v_existing_deposit.id IS NOT NULL AND v_existing_onchain.id IS NOT NULL
         AND upper(btrim(coalesce(v_existing_deposit.status, ''))) = 'CONFIRMED'
         AND upper(btrim(coalesce(v_existing_onchain.status, ''))) IN ('CONFIRMED', 'CREDITED') THEN
        RETURN jsonb_build_object('success', true, 'credited', false, 'already_processed', true,
          'status', 'ALREADY_PROCESSED', 'deposit_id', v_existing_deposit.id,
          'onchain_deposit_id', v_existing_onchain.id, 'user_id', v_user_id,
          'asset', v_asset, 'network', v_network, 'amount', p_amount);
      END IF;
      RETURN jsonb_build_object('success', false, 'credited', false,
        'code', 'EXISTING_DEPOSIT_STATE_MISMATCH');
    END IF;

    IF v_existing_deposit.id IS NULL THEN
      INSERT INTO public.deposits(user_id,chain,token_symbol,tx_hash,amount,from_address,to_address,status,block_number,created_at,asset,output_index)
      VALUES(v_user_id,v_network,v_asset,v_hash,p_amount,coalesce(nullif(btrim(coalesce(p_from_address,'')),''),''),v_address,'pending',p_block_number,now(),v_asset,p_output_index)
      RETURNING id INTO v_deposit_id;
    ELSE
      v_deposit_id := v_existing_deposit.id;
    END IF;

    IF v_existing_onchain.id IS NULL THEN
      INSERT INTO public.onchain_deposits(user_id,tx_hash,network,address,amount,asset_symbol,confirmations,required_confirmations,status,created_at,updated_at,to_address,asset,asset_code,network_code,output_index)
      VALUES(v_user_id,v_hash,v_network,v_address,p_amount,v_asset,0,v_required,'PENDING',now(),now(),v_address,v_asset,v_asset,v_network,p_output_index)
      RETURNING id INTO v_onchain_id;
    ELSE
      v_onchain_id := v_existing_onchain.id;
      -- Never rewrite an existing confirmation count/status here; legacy values require reconciliation.
    END IF;

    RETURN jsonb_build_object('success',true,'credited',false,'status','PENDING',
      'deposit_id',v_deposit_id,'onchain_deposit_id',v_onchain_id,'user_id',v_user_id,
      'asset',v_asset,'network',v_network,'amount',p_amount,'confirmations',0,
      'required_confirmations',v_required,'provider',left(coalesce(p_provider,'internal'),80));
END;
$function$;

REVOKE ALL ON FUNCTION public.register_pending_deposit(text,text,text,numeric,text,integer,bigint,text,text,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_pending_deposit(text,text,text,numeric,text,integer,bigint,text,text,integer,text) TO service_role, postgres;
COMMIT;
