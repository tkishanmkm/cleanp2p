-- A replay of an existing outpoint must match its original amount, asset and
-- destination. This prevents an indexer/scanner discrepancy from changing the
-- credited amount for an already-known tx/output key.
BEGIN;

DO $migration$
DECLARE
    v_signature REGPROCEDURE :=
      'public.process_deposit_atomic(text,text,text,numeric,text,integer,bigint,text,text,integer,text)'::REGPROCEDURE;
    v_definition TEXT;
    v_updated TEXT;
    v_replacement TEXT;
BEGIN
    SELECT pg_get_functiondef(v_signature) INTO v_definition;

    v_replacement := $replacement$
    SELECT *
    INTO v_existing_onchain
    FROM public.onchain_deposits
    WHERE LOWER(BTRIM(tx_hash)) = v_tx_hash
      AND UPPER(BTRIM(network)) = v_network
      AND output_index = p_output_index
    FOR UPDATE;

    IF v_existing_deposit.id IS NOT NULL AND (
        v_existing_deposit.amount IS DISTINCT FROM p_amount
        OR UPPER(BTRIM(COALESCE(v_existing_deposit.token_symbol, v_existing_deposit.asset))) IS DISTINCT FROM v_asset
        OR (
            v_existing_deposit.to_address IS NOT NULL
            AND CASE WHEN v_network IN ('ETH', 'ERC20', 'BEP20')
                THEN LOWER(BTRIM(v_existing_deposit.to_address))
                ELSE BTRIM(v_existing_deposit.to_address)
            END IS DISTINCT FROM v_address
        )
    ) THEN
        RETURN jsonb_build_object('success', false, 'code', 'DEPOSIT_REPLAY_MISMATCH');
    END IF;

    IF v_existing_onchain.id IS NOT NULL AND (
        v_existing_onchain.amount IS DISTINCT FROM p_amount
        OR UPPER(BTRIM(COALESCE(v_existing_onchain.asset_symbol, v_existing_onchain.asset_code, v_existing_onchain.asset, v_existing_onchain.coin))) IS DISTINCT FROM v_asset
        OR (
            COALESCE(v_existing_onchain.to_address, v_existing_onchain.address) IS NOT NULL
            AND CASE WHEN v_network IN ('ETH', 'ERC20', 'BEP20')
                THEN LOWER(BTRIM(COALESCE(v_existing_onchain.to_address, v_existing_onchain.address)))
                ELSE BTRIM(COALESCE(v_existing_onchain.to_address, v_existing_onchain.address))
            END IS DISTINCT FROM v_address
        )
    ) THEN
        RETURN jsonb_build_object('success', false, 'code', 'DEPOSIT_REPLAY_MISMATCH');
    END IF;
    $replacement$;

    v_updated := regexp_replace(
        v_definition,
        'SELECT \*[[:space:]]+INTO v_existing_onchain[[:space:]]+FROM public\.onchain_deposits[[:space:]]+WHERE LOWER\(BTRIM\(tx_hash\)\) = v_tx_hash[[:space:]]+AND UPPER\(BTRIM\(network\)\) = v_network[[:space:]]+AND output_index = p_output_index[[:space:]]+FOR UPDATE;',
        v_replacement,
        'g'
    );

    IF v_updated = v_definition
       OR position('DEPOSIT_REPLAY_MISMATCH' IN v_updated) = 0
       OR position('INTO v_existing_onchain' IN v_updated) = 0 THEN
        RAISE EXCEPTION 'Could not safely add deposit replay consistency checks; no changes applied';
    END IF;

    EXECUTE v_updated;
END
$migration$;

ALTER FUNCTION public.process_deposit_atomic(
  text, text, text, numeric, text, integer, bigint, text, text, integer, text
) SET search_path = '';

COMMIT;
