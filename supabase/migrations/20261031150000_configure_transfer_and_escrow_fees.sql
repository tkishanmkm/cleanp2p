-- Move the configured percentage fees into the authoritative financial RPCs
-- and align transfer receipts/replays with the published user contract:
-- entered amount is the recipient amount; sender pays amount + fee.
BEGIN;

DO $migration$
DECLARE
    v_oid oid;
    v_definition text;
    v_updated text;
    v_old text;
BEGIN
    v_oid := to_regprocedure('public.execute_internal_transfer(uuid,text,text,numeric,text)');
    IF v_oid IS NULL THEN
        RAISE EXCEPTION 'Required execute_internal_transfer RPC is missing.';
    END IF;

    v_definition := pg_get_functiondef(v_oid);
    v_definition := replace(v_definition, E'\r\n', E'\n');

    -- Both functions are SECURITY DEFINER. Restrict name resolution to built-ins;
    -- application objects in their bodies are schema-qualified.
    v_old := 'SET search_path TO ''public'', ''pg_temp''';
    IF position(v_old IN v_definition) = 0 THEN
        RAISE EXCEPTION 'Could not locate execute_internal_transfer search_path; aborting.';
    END IF;
    v_definition := replace(v_definition, v_old, 'SET search_path TO pg_catalog');

    -- Require a verifiable session identity for every non-service caller.
    v_old := 'IF auth.role() <> ''service_role'' AND auth.uid() IS NOT NULL AND auth.uid() <> p_sender_id THEN';
    IF position(v_old IN v_definition) = 0 THEN
        RAISE EXCEPTION 'Could not locate transfer caller identity guard; aborting.';
    END IF;
    v_definition := replace(
        v_definition,
        v_old,
        'IF auth.role() <> ''service_role'' AND (auth.uid() IS NULL OR auth.uid() <> p_sender_id) THEN'
    );

    -- Remove hardcoded 1.5% and load the current validated admin setting after
    -- the idempotent-replay branch, so a retry returns its original stored fee.
    v_updated := replace(
        v_definition,
        'v_fee_rate NUMERIC(10, 6) := 0.015; -- 1.5% platform fee',
        'v_fee_rate NUMERIC(10, 6);'
    );

    IF v_updated = v_definition THEN
        RAISE EXCEPTION 'Could not locate transfer fee-rate declaration; aborting.';
    END IF;

    v_old := E'    END IF;\n    \n    IF v_clean_username = '''' THEN';
    IF position(v_old IN v_updated) = 0 THEN
        v_old := E'    END IF;\n\n    IF v_clean_username = '''' THEN';
    END IF;
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
    v_updated := replace(v_updated, v_old,
        '(ROUND(v_existing_transfer.amount, 8) IS DISTINCT FROM ROUND(p_gross_amount, 8) AND ROUND(v_existing_transfer.amount + COALESCE(v_existing_transfer.fee_amount, 0), 8) IS DISTINCT FROM ROUND(p_gross_amount, 8))');

    v_old := E'''gross_amount'', v_existing_transfer.amount + COALESCE(v_existing_transfer.fee_amount, 0),\n            ''fee_amount'', COALESCE(v_existing_transfer.fee_amount, 0),\n            ''status'', v_existing_transfer.status,';
    IF position(v_old IN v_updated) = 0 THEN
        RAISE EXCEPTION 'Could not locate transfer replay response fields; aborting.';
    END IF;
    v_updated := replace(v_updated, v_old,
        E'''gross_amount'', p_gross_amount,\n            ''fee_amount'', COALESCE(v_existing_transfer.fee_amount, 0),\n            ''net_amount'', v_existing_transfer.amount,\n            ''total_deduction'', v_existing_transfer.amount + COALESCE(v_existing_transfer.fee_amount, 0),\n            ''legacy_fee_model'', (ROUND(v_existing_transfer.amount + COALESCE(v_existing_transfer.fee_amount, 0), 8) = ROUND(p_gross_amount, 8) AND ROUND(v_existing_transfer.amount, 8) <> ROUND(p_gross_amount, 8)),\n            ''idempotent_replay'', TRUE,\n            ''status'', v_existing_transfer.status,');

    v_old := E'    v_total_deduction := ROUND(p_gross_amount, 8);\n    v_fee_amount := ROUND(v_total_deduction * v_fee_rate, 8);\n    v_recipient_amount := v_total_deduction - v_fee_amount;';
    IF position(v_old IN v_updated) = 0 THEN
        RAISE EXCEPTION 'Could not locate transfer calculation block; aborting.';
    END IF;
    v_updated := replace(v_updated, v_old,
        E'    v_recipient_amount := ROUND(p_gross_amount, 8);\n    v_fee_amount := ROUND(v_recipient_amount * v_fee_rate, 8);\n    v_total_deduction := v_recipient_amount + v_fee_amount;');

    v_old := E'             v_asset_clean || '':'' || \n             v_total_deduction::TEXT)::bytea';
    IF position(v_old IN v_updated) = 0 THEN
        RAISE EXCEPTION 'Could not locate transfer request fingerprint input; aborting.';
    END IF;
    v_updated := replace(v_updated, v_old,
        E'             v_asset_clean || '':'' || \n             ROUND(p_gross_amount, 8)::TEXT)::bytea');

    v_old := E'''gross_amount'', v_total_deduction,\n        ''fee_amount'', v_fee_amount,\n        ''net_amount'', v_recipient_amount,\n        ''status'', ''confirmed''';
    IF position(v_old IN v_updated) = 0 THEN
        RAISE EXCEPTION 'Could not locate final transfer response fields; aborting.';
    END IF;
    v_updated := replace(v_updated, v_old,
        E'''gross_amount'', v_recipient_amount,\n        ''fee_amount'', v_fee_amount,\n        ''net_amount'', v_recipient_amount,\n        ''total_deduction'', v_total_deduction,\n        ''legacy_fee_model'', FALSE,\n        ''idempotent_replay'', FALSE,\n        ''status'', ''confirmed''');

    IF position('v_fee_rate NUMERIC(10, 6) := 0.015' IN v_updated) > 0
       OR position('v_total_deduction := ROUND(p_gross_amount, 8)' IN v_updated) > 0
       OR position('''total_deduction'', v_total_deduction' IN v_updated) = 0
       OR position('legacy_fee_model' IN v_updated) = 0 THEN
        RAISE EXCEPTION 'Transfer fee/receipt patch verification failed; aborting.';
    END IF;

    EXECUTE v_updated;

    -- Configure P2P escrow fee using the same canonical key/value settings table.
    v_oid := to_regprocedure('public.initiate_trade_with_escrow(text,numeric,numeric,text,numeric,text,text,text,uuid)');
    IF v_oid IS NULL THEN
        RAISE EXCEPTION 'Required initiate_trade_with_escrow RPC is missing.';
    END IF;

    v_definition := pg_get_functiondef(v_oid);
    v_definition := replace(v_definition, E'\r\n', E'\n');

    -- Do not allow an authenticated-role RPC caller to supply an arbitrary actor.
    -- Service-role calls are accepted only with a server-verified caller ID.
    v_old := 'SET search_path TO ''public'', ''pg_temp''';
    IF position(v_old IN v_definition) = 0 THEN
        RAISE EXCEPTION 'Could not locate initiate_trade_with_escrow search_path; aborting.';
    END IF;
    v_definition := replace(v_definition, v_old, 'SET search_path TO pg_catalog');

    v_old := E'    IF v_auth_uid IS NOT NULL THEN\n        IF p_caller_id IS NOT NULL AND p_caller_id <> v_auth_uid THEN\n            RAISE EXCEPTION ''Caller ID mismatch: unauthorized impersonation.'';\n        END IF;\n        v_effective_caller := v_auth_uid;\n    ELSE\n        IF p_caller_id IS NULL THEN\n            RAISE EXCEPTION ''Authentication required: neither session token nor trusted caller ID provided.'';\n        END IF;\n        v_effective_caller := p_caller_id;\n    END IF;';
    IF position(v_old IN v_definition) = 0 THEN
        RAISE EXCEPTION 'Could not locate escrow caller identity guard; aborting.';
    END IF;
    v_definition := replace(
        v_definition,
        v_old,
        E'    IF auth.role() = ''service_role'' THEN\n        IF p_caller_id IS NULL THEN\n            RAISE EXCEPTION ''Trusted service caller ID is required.'';\n        END IF;\n        v_effective_caller := p_caller_id;\n    ELSE\n        IF v_auth_uid IS NULL THEN\n            RAISE EXCEPTION ''Authentication required: session user could not be verified.'';\n        END IF;\n        IF p_caller_id IS NOT NULL AND p_caller_id <> v_auth_uid THEN\n            RAISE EXCEPTION ''Caller ID mismatch: unauthorized impersonation.'';\n        END IF;\n        v_effective_caller := v_auth_uid;\n    END IF;'
    );

    v_updated := replace(
        v_definition,
        '    v_escrow_fee NUMERIC(36, 18);',
        '    v_escrow_fee NUMERIC(36, 18);' || E'\n    v_escrow_fee_rate NUMERIC(10, 6);'
    );
    IF v_updated = v_definition THEN
        RAISE EXCEPTION 'Could not locate P2P escrow fee variable declaration; aborting.';
    END IF;

    v_old := '    v_escrow_fee := ROUND(v_crypto_amount * 0.015, 8);';
    IF position(v_old IN v_updated) = 0 THEN
        RAISE EXCEPTION 'Could not locate P2P escrow fee calculation; aborting.';
    END IF;
    v_updated := replace(v_updated, v_old,
        E'    SELECT (value::numeric / 100)::numeric(10,6)\n      INTO v_escrow_fee_rate\n      FROM public.app_settings\n     WHERE key = ''escrow_fee_percent'';\n\n    IF NOT FOUND OR v_escrow_fee_rate IS NULL OR v_escrow_fee_rate < 0 OR v_escrow_fee_rate > 0.10 THEN\n        RAISE EXCEPTION ''P2P escrow fee configuration is missing or invalid.''\n            USING ERRCODE = ''P0001'', DETAIL = ''ESCROW_FEE_CONFIG_UNAVAILABLE'';\n    END IF;\n\n    v_escrow_fee := ROUND(v_crypto_amount * v_escrow_fee_rate, 8);'
    );

    IF position('v_crypto_amount * 0.015' IN v_updated) > 0
       OR position('v_escrow_fee := ROUND(v_crypto_amount * v_escrow_fee_rate, 8)' IN v_updated) = 0 THEN
        RAISE EXCEPTION 'P2P escrow fee patch verification failed; aborting.';
    END IF;

    EXECUTE v_updated;
END;
$migration$;

COMMIT;
