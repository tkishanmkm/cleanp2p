-- Reconcile the authoritative transfer and P2P escrow fees with the
-- app_settings values read by the application.  Preserve already saved values.
-- Transfer receipt/replay fields are aligned with the API integrity contract.
BEGIN;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES
    ('platform_fee_percent', '1.5', pg_catalog.clock_timestamp()),
    ('escrow_fee_percent', '1.5', pg_catalog.clock_timestamp()),
    ('min_trade_amount', '10', pg_catalog.clock_timestamp())
ON CONFLICT (key) DO NOTHING;

DO $migration$
DECLARE
    v_oid oid;
    v_definition text;
    v_updated text;
    v_old text;
BEGIN
    -- Internal transfers: use the configured fee and return a receipt contract
    -- that explicitly distinguishes recipient amount, fee, and total debit.
    v_oid := to_regprocedure('public.execute_internal_transfer(uuid,text,text,numeric,text)');
    IF v_oid IS NULL THEN
        RAISE EXCEPTION 'Required execute_internal_transfer RPC is missing.';
    END IF;

    v_definition := pg_get_functiondef(v_oid);
    v_definition := replace(v_definition, E'\r\n', E'\n');

    v_old := 'SET search_path TO ''public'', ''pg_temp''';
    IF position(v_old IN v_definition) = 0 THEN
        RAISE EXCEPTION 'Could not locate execute_internal_transfer search_path; aborting.';
    END IF;
    v_definition := replace(v_definition, v_old, 'SET search_path TO pg_catalog');

    v_old := 'IF auth.role() <> ''service_role'' AND auth.uid() IS NOT NULL AND auth.uid() <> p_sender_id THEN';
    IF position(v_old IN v_definition) = 0 THEN
        RAISE EXCEPTION 'Could not locate transfer caller identity guard; aborting.';
    END IF;
    v_definition := replace(
        v_definition,
        v_old,
        'IF auth.role() <> ''service_role'' AND (auth.uid() IS NULL OR auth.uid() <> p_sender_id) THEN'
    );

    v_updated := replace(
        v_definition,
        'v_fee_rate NUMERIC(10, 6) := 0.015; -- 1.5% platform fee',
        'v_fee_rate NUMERIC(10, 6);'
    );
    IF v_updated = v_definition THEN
        RAISE EXCEPTION 'Could not locate transfer fee-rate declaration; aborting.';
    END IF;

    v_old := E'    END IF;\n\n    IF v_clean_username = '''' THEN';
    IF position(v_old IN v_updated) = 0 THEN
        RAISE EXCEPTION 'Could not locate transfer idempotency branch boundary; aborting.';
    END IF;
    v_updated := replace(
        v_updated,
        v_old,
        E'    END IF;\n\n    SELECT (value::numeric / 100)::numeric(10,6)\n      INTO v_fee_rate\n      FROM public.app_settings\n     WHERE key = ''platform_fee_percent'';\n\n    IF NOT FOUND OR v_fee_rate IS NULL OR v_fee_rate < 0 OR v_fee_rate > 0.10 THEN\n        RAISE EXCEPTION ''Platform transfer fee configuration is missing or invalid.''\n            USING ERRCODE = ''P0001'', DETAIL = ''PLATFORM_FEE_CONFIG_UNAVAILABLE'';\n    END IF;\n\n    IF v_clean_username = '''' THEN'
    );

    v_old := 'ROUND(v_existing_transfer.amount + COALESCE(v_existing_transfer.fee_amount, 0), 8) IS DISTINCT FROM ROUND(p_gross_amount, 8)';
    IF position(v_old IN v_updated) = 0 THEN
        RAISE EXCEPTION 'Could not locate transfer replay amount guard; aborting.';
    END IF;
    v_updated := replace(
        v_updated,
        v_old,
        '(ROUND(v_existing_transfer.amount, 8) IS DISTINCT FROM ROUND(p_gross_amount, 8) AND ROUND(v_existing_transfer.amount + COALESCE(v_existing_transfer.fee_amount, 0), 8) IS DISTINCT FROM ROUND(p_gross_amount, 8))'
    );

    v_old := E'''gross_amount'', v_existing_transfer.amount + COALESCE(v_existing_transfer.fee_amount, 0),\n            ''fee_amount'', COALESCE(v_existing_transfer.fee_amount, 0),\n            ''status'', v_existing_transfer.status,';
    IF position(v_old IN v_updated) = 0 THEN
        RAISE EXCEPTION 'Could not locate transfer replay response fields; aborting.';
    END IF;
    v_updated := replace(
        v_updated,
        v_old,
        E'''gross_amount'', p_gross_amount,\n            ''fee_amount'', COALESCE(v_existing_transfer.fee_amount, 0),\n            ''net_amount'', v_existing_transfer.amount,\n            ''total_deduction'', v_existing_transfer.amount + COALESCE(v_existing_transfer.fee_amount, 0),\n            ''legacy_fee_model'', (ROUND(v_existing_transfer.amount + COALESCE(v_existing_transfer.fee_amount, 0), 8) = ROUND(p_gross_amount, 8) AND ROUND(v_existing_transfer.amount, 8) <> ROUND(p_gross_amount, 8)),\n            ''idempotent_replay'', TRUE,\n            ''status'', v_existing_transfer.status,'
    );

    v_old := E'    v_total_deduction := ROUND(p_gross_amount, 8);\n    v_fee_amount := ROUND(v_total_deduction * v_fee_rate, 8);\n    v_recipient_amount := v_total_deduction - v_fee_amount;';
    IF position(v_old IN v_updated) = 0 THEN
        RAISE EXCEPTION 'Could not locate transfer calculation block; aborting.';
    END IF;
    v_updated := replace(
        v_updated,
        v_old,
        E'    v_recipient_amount := ROUND(p_gross_amount, 8);\n    v_fee_amount := ROUND(v_recipient_amount * v_fee_rate, 8);\n    v_total_deduction := v_recipient_amount + v_fee_amount;'
    );

    v_old := E'             v_asset_clean || '':'' || \n             v_total_deduction::TEXT)::bytea';
    IF position(v_old IN v_updated) = 0 THEN
        RAISE EXCEPTION 'Could not locate transfer request fingerprint input; aborting.';
    END IF;
    v_updated := replace(
        v_updated,
        v_old,
        E'             v_asset_clean || '':'' || \n             ROUND(p_gross_amount, 8)::TEXT)::bytea'
    );

    v_old := E'''gross_amount'', v_total_deduction,\n        ''fee_amount'', v_fee_amount,\n        ''net_amount'', v_recipient_amount,\n        ''status'', ''confirmed''';
    IF position(v_old IN v_updated) = 0 THEN
        RAISE EXCEPTION 'Could not locate final transfer response fields; aborting.';
    END IF;
    v_updated := replace(
        v_updated,
        v_old,
        E'''gross_amount'', v_recipient_amount,\n        ''fee_amount'', v_fee_amount,\n        ''net_amount'', v_recipient_amount,\n        ''total_deduction'', v_total_deduction,\n        ''legacy_fee_model'', FALSE,\n        ''idempotent_replay'', FALSE,\n        ''status'', ''confirmed'''
    );

    IF position('v_fee_rate NUMERIC(10, 6) := 0.015' IN v_updated) > 0
       OR position('v_total_deduction := ROUND(p_gross_amount, 8)' IN v_updated) > 0
       OR position('''total_deduction'', v_total_deduction' IN v_updated) = 0
       OR position('legacy_fee_model' IN v_updated) = 0 THEN
        RAISE EXCEPTION 'Transfer fee/receipt patch verification failed; aborting.';
    END IF;

    EXECUTE v_updated;

    -- P2P escrow: load the same admin-configured fee that the settings screen
    -- displays. This function already has an empty search_path and a guarded
    -- trusted-actor identity check; preserve those controls unchanged.
    v_oid := to_regprocedure('public.initiate_trade_with_escrow(text,numeric,numeric,text,numeric,text,text,text,uuid)');
    IF v_oid IS NULL THEN
        RAISE EXCEPTION 'Required initiate_trade_with_escrow RPC is missing.';
    END IF;

    v_definition := pg_get_functiondef(v_oid);
    v_definition := replace(v_definition, E'\r\n', E'\n');

    v_old := '    v_escrow_fee NUMERIC(36, 18);';
    IF position(v_old IN v_definition) = 0
       OR position(v_old IN substring(v_definition FROM position(v_old IN v_definition) + length(v_old))) > 0 THEN
        RAISE EXCEPTION 'Could not locate one unique P2P escrow fee declaration; aborting.';
    END IF;
    v_updated := replace(
        v_definition,
        v_old,
        v_old || E'\n    v_escrow_fee_rate NUMERIC(10, 6);'
    );

    v_old := '    v_escrow_fee := ROUND(v_crypto_amount * 0.015, 8);';
    IF position(v_old IN v_updated) = 0
       OR position(v_old IN substring(v_updated FROM position(v_old IN v_updated) + length(v_old))) > 0 THEN
        RAISE EXCEPTION 'Could not locate one unique hard-coded P2P escrow fee calculation; aborting.';
    END IF;
    v_updated := replace(
        v_updated,
        v_old,
        E'    SELECT (value::numeric / 100)::numeric(10,6)\n      INTO v_escrow_fee_rate\n      FROM public.app_settings\n     WHERE key = ''escrow_fee_percent'';\n\n    IF NOT FOUND OR v_escrow_fee_rate IS NULL OR v_escrow_fee_rate < 0 OR v_escrow_fee_rate > 0.10 THEN\n        RAISE EXCEPTION ''P2P escrow fee configuration is missing or invalid.''\n            USING ERRCODE = ''P0001'', DETAIL = ''ESCROW_FEE_CONFIG_UNAVAILABLE'';\n    END IF;\n\n    v_escrow_fee := ROUND(v_crypto_amount * v_escrow_fee_rate, 8);'
    );

    IF position('v_crypto_amount * 0.015' IN v_updated) > 0
       OR position('v_escrow_fee := ROUND(v_crypto_amount * v_escrow_fee_rate, 8)' IN v_updated) = 0
       OR position('SET search_path TO ''''' IN v_updated) = 0 THEN
        RAISE EXCEPTION 'P2P escrow fee patch verification failed; aborting.';
    END IF;

    EXECUTE v_updated;
END;
$migration$;

COMMIT;
