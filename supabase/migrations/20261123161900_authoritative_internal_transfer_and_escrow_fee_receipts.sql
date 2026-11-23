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


ALTER FUNCTION public.execute_internal_transfer(UUID,TEXT,TEXT,NUMERIC,TEXT)
  SET search_path = '';

DO $platform_fee_ledger_patch$
DECLARE
    v_definition TEXT;
    v_old TEXT := $old$
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'transfer_id', v_transfer_id,
$old$;
    v_new TEXT := $new$
        NOW()
    );

    -- Record collected platform revenue in the authoritative platform ledger.
    IF v_fee_amount > 0 THEN
        INSERT INTO public.platform_ledger_entries (
            entry_type, asset_code, amount, direction, related_user_id,
            ref_table, ref_id, network_code, idempotency_key, metadata, created_at
        ) VALUES (
            'transfer_fee_collected',
            v_asset_clean,
            v_fee_amount,
            'CREDIT',
            p_sender_id,
            'transfers',
            v_transfer_id::TEXT,
            'INTERNAL',
            'fee_transfer_' || v_transfer_id::TEXT,
            jsonb_build_object(
                'transfer_id', v_transfer_id,
                'public_id', v_public_id,
                'sender_id', p_sender_id,
                'recipient_id', v_recipient_id,
                'recipient_amount', v_recipient_amount,
                'fee_amount', v_fee_amount,
                'fee_rate', v_fee_rate,
                'total_deduction', v_total_deduction,
                'asset', v_asset_clean,
                'original_idempotency_key', v_clean_idempotency
            ),
            NOW()
        );
    END IF;

    -- Recipient notifications are best-effort and never undo a transfer.
    BEGIN
        INSERT INTO public.notifications (
            user_id, type, title, message, metadata, is_read, created_at
        ) VALUES (
            v_recipient_id,
            'transfer',
            'Transfer Received',
            'You received ' || v_recipient_amount::TEXT || ' ' || v_asset_clean || ' from @' || v_sender_name,
            jsonb_build_object(
                'sender_id', p_sender_id,
                'sender_username', v_sender_name,
                'amount', v_recipient_amount,
                'asset', v_asset_clean,
                'transfer_id', v_transfer_id,
                'public_id', v_public_id,
                'link', '/wallet'
            ),
            FALSE,
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    RETURN jsonb_build_object(
        'success', true,
        'transfer_id', v_transfer_id,
$new$;
BEGIN
    SELECT pg_catalog.pg_get_functiondef(
        'public.execute_internal_transfer(uuid,text,text,numeric,text)'::regprocedure
    ) INTO v_definition;

    IF pg_catalog.strpos(v_definition, v_old) = 0
       OR pg_catalog.strpos(
          pg_catalog.substr(v_definition, pg_catalog.strpos(v_definition, v_old) + pg_catalog.length(v_old)),
          v_old
       ) > 0 THEN
        RAISE EXCEPTION 'Could not uniquely locate final internal-transfer receipt insertion point.';
    END IF;

    v_definition := pg_catalog.replace(v_definition, v_old, v_new);

    IF pg_catalog.strpos(v_definition, 'INSERT INTO public.platform_ledger_entries') = 0
       OR pg_catalog.strpos(v_definition, '''transfer_fee_collected''') = 0 THEN
        RAISE EXCEPTION 'Platform fee ledger postcondition failed.';
    END IF;

    EXECUTE v_definition;
END;
$platform_fee_ledger_patch$;

-- Disable the obsolete multi-table transfer path; the app uses only the
-- server-authenticated execute_internal_transfer contract.
REVOKE ALL ON FUNCTION public.execute_wallet_transfer(uuid,uuid,text,numeric,numeric,text)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.execute_internal_transfer(UUID,TEXT,TEXT,NUMERIC,TEXT) IS
  'Canonical server-only internal transfer. Recipient receives the requested amount; sender pays the amount plus configured fee. Persists user and platform ledger receipts.';
DO $dependency$
DECLARE
    v_definition text;
BEGIN
    IF to_regprocedure('public.execute_internal_transfer(uuid,text,text,numeric,text)') IS NULL
       OR to_regclass('public.transfers') IS NULL
       OR to_regclass('public.ledger_entries') IS NULL THEN
        RAISE EXCEPTION 'Canonical transfer function or receipt/ledger tables are missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='ledger_entries'
          AND column_name='metadata' AND data_type='jsonb'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='ledger_entries'
          AND column_name='reference_id'
    ) THEN
        RAISE EXCEPTION 'Ledger fee-rate snapshot fields are unavailable';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(
        'public.execute_internal_transfer(uuid,text,text,numeric,text)'::regprocedure
    ) INTO v_definition;

    IF pg_catalog.strpos(v_definition, 'public.app_settings') = 0
       OR pg_catalog.strpos(v_definition, '''fee_rate'', v_fee_rate') = 0
       OR pg_catalog.strpos(v_definition, '''total_deduction'', v_total_deduction') = 0
       OR NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc p
            WHERE p.oid = 'public.execute_internal_transfer(uuid,text,text,numeric,text)'::regprocedure
              AND (
                  'search_path=pg_catalog' = ANY(coalesce(p.proconfig,ARRAY[]::text[]))
                  OR 'search_path=""' = ANY(coalesce(p.proconfig,ARRAY[]::text[]))
              )
       ) THEN
        RAISE EXCEPTION 'Configured-fee transfer migration must be installed before fee snapshot receipt patch';
    END IF;
END;
$dependency$;

DO $patch_transfer_receipts$
DECLARE
    v_definition text;
    v_old text;
    v_new text;
    v_position integer;
BEGIN
    SELECT pg_catalog.pg_get_functiondef(
        'public.execute_internal_transfer(uuid,text,text,numeric,text)'::regprocedure
    ) INTO v_definition;

    v_old := '    v_fee_rate NUMERIC(10, 6);';
    IF pg_catalog.strpos(v_definition, v_old) = 0
       OR pg_catalog.strpos(
            pg_catalog.substr(v_definition, pg_catalog.strpos(v_definition, v_old) + pg_catalog.length(v_old)),
            v_old
          ) <> 0 THEN
        RAISE EXCEPTION 'Could not uniquely locate transfer fee-rate variable declaration';
    END IF;

    v_definition := pg_catalog.replace(
        v_definition,
        v_old,
        v_old || E'\n    v_existing_fee_rate NUMERIC;'
    );

    -- Read the fee snapshot from the committed SENT ledger row. Historical
    -- records without a snapshot return NULL; their immutable amount/fee
    -- arithmetic is still verified by the API, without applying today's rate.
    v_old := $marker$
        RETURN jsonb_build_object(
            'success', true,
            'transfer_id', v_existing_transfer.id,
$marker$;
    v_new := $replacement$
        SELECT (metadata->>'fee_rate')::numeric
          INTO v_existing_fee_rate
          FROM public.ledger_entries
         WHERE user_id = p_sender_id
           AND reference_id = v_existing_transfer.id::text
           AND metadata->>'direction' = 'SENT'
           AND NULLIF(pg_catalog.btrim(metadata->>'fee_rate'), '') IS NOT NULL
         ORDER BY created_at ASC, id ASC
         LIMIT 1;

        RETURN jsonb_build_object(
            'success', true,
            'transfer_id', v_existing_transfer.id,
$replacement$;

    v_position := pg_catalog.strpos(v_definition, v_old);
    IF v_position = 0
       OR pg_catalog.strpos(
            pg_catalog.substr(v_definition, v_position + pg_catalog.length(v_old)),
            v_old
          ) <> 0 THEN
        RAISE EXCEPTION 'Could not uniquely locate idempotent transfer receipt return';
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);

    v_old := $marker$            'total_deduction', v_existing_transfer.amount + COALESCE(v_existing_transfer.fee_amount, 0),
            'legacy_fee_model',$marker$;
    v_new := $replacement$            'total_deduction', v_existing_transfer.amount + COALESCE(v_existing_transfer.fee_amount, 0),
            'fee_rate', v_existing_fee_rate,
            'legacy_fee_model',$replacement$;

    v_position := pg_catalog.strpos(v_definition, v_old);
    IF v_position = 0
       OR pg_catalog.strpos(
            pg_catalog.substr(v_definition, v_position + pg_catalog.length(v_old)),
            v_old
          ) <> 0 THEN
        RAISE EXCEPTION 'Could not uniquely locate idempotent transfer fee receipt fields';
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);

    v_old := $marker$        'total_deduction', v_total_deduction,
        'legacy_fee_model', FALSE,$marker$;
    v_new := $replacement$        'total_deduction', v_total_deduction,
        'fee_rate', v_fee_rate,
        'legacy_fee_model', FALSE,$replacement$;

    v_position := pg_catalog.strpos(v_definition, v_old);
    IF v_position = 0
       OR pg_catalog.strpos(
            pg_catalog.substr(v_definition, v_position + pg_catalog.length(v_old)),
            v_old
          ) <> 0 THEN
        RAISE EXCEPTION 'Could not uniquely locate new transfer fee receipt fields';
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);

    IF pg_catalog.strpos(v_definition, 'v_existing_fee_rate NUMERIC') = 0
       OR pg_catalog.strpos(v_definition, '''fee_rate'', v_existing_fee_rate') = 0
       OR pg_catalog.strpos(v_definition, '''fee_rate'', v_fee_rate') = 0
       OR pg_catalog.strpos(v_definition, 'metadata->>''direction'' = ''SENT''') = 0 THEN
        RAISE EXCEPTION 'Transfer fee snapshot receipt patch verification failed';
    END IF;

    EXECUTE v_definition;
END;
$patch_transfer_receipts$;

NOTIFY pgrst, 'reload schema';

COMMIT;
