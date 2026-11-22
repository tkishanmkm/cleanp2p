-- Read-only contract preflight for durable EVM and BTC/LTC sweep signing.
-- Run only after the signed-intent, reserved-value and UTXO-lifecycle migrations.
-- No transaction, nonce, reservation or broadcast is created by this script.
DO $preflight$
DECLARE
    v_evm regprocedure := pg_catalog.to_regprocedure(
        'public.persist_signed_evm_transaction(uuid,text,text,bigint,text,text,text,text,text,numeric,bigint,integer)'
    );
    v_btc_ltc regprocedure := pg_catalog.to_regprocedure(
        'public.persist_signed_btc_ltc_transaction(uuid,text,text,text,text,jsonb,integer)'
    );
    v_reserve regprocedure := pg_catalog.to_regprocedure(
        'public.reserve_utxos_for_sweep(uuid,text,text,jsonb,integer)'
    );
    v_fn regprocedure;
    v_trigger_fn regprocedure;
    v_trigger_functions regprocedure[] := ARRAY[
        pg_catalog.to_regprocedure('public.prevent_signed_sweep_intent_mutation()'),
        pg_catalog.to_regprocedure('public.prevent_signed_utxo_sweep_failure()'),
        pg_catalog.to_regprocedure('public.protect_signed_utxo_reservation_lifecycle()'),
        pg_catalog.to_regprocedure('public.require_signed_utxo_values_match_reservations()')
    ]::regprocedure[];
    v_definition text;
    v_column_table text;
    v_column_name text;
    v_trigger_pair text[];
    v_required_triggers text[][] := ARRAY[
        ARRAY['sweep_operations','trg_prevent_signed_sweep_intent_mutation'],
        ARRAY['sweep_operations','trg_prevent_signed_utxo_sweep_failure'],
        ARRAY['sweep_operations','trg_require_signed_utxo_values_match_reservations'],
        ARRAY['utxo_reservations','trg_protect_signed_utxo_reservation_lifecycle']
    ];
BEGIN
    -- The current worker calls these exact overloads. Older signatures must
    -- not remain as substitutes: the JSON intent is part of the persisted contract.
    IF v_evm IS NULL OR v_btc_ltc IS NULL THEN
        RAISE EXCEPTION 'Intent-bound EVM or BTC/LTC signed-persistence RPC is missing';
    END IF;

    IF pg_catalog.to_regprocedure(
        'public.persist_signed_evm_transaction(uuid,text,text,bigint,text,text,integer)'
    ) IS NOT NULL THEN
        RAISE EXCEPTION 'Legacy seven-argument EVM signed-persistence RPC remains after intent migration';
    END IF;

    IF pg_catalog.to_regprocedure(
        'public.persist_signed_btc_ltc_transaction(uuid,text,text,text,text,integer)'
    ) IS NOT NULL THEN
        RAISE EXCEPTION 'Legacy six-argument BTC/LTC signed-persistence RPC remains after intent migration';
    END IF;

    FOREACH v_fn IN ARRAY ARRAY[v_evm, v_btc_ltc]::regprocedure[]
    LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc p
            WHERE p.oid = v_fn
              AND p.prosecdef IS TRUE
              AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
              AND 'search_path=""' = ANY(coalesce(p.proconfig, ARRAY[]::text[]))
        ) THEN
            RAISE EXCEPTION 'Signed-persistence RPC % must be postgres-owned SECURITY DEFINER with empty search_path', v_fn;
        END IF;

        IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE')
           OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
           OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
           OR EXISTS (
                SELECT 1
                FROM pg_catalog.pg_proc p
                CROSS JOIN LATERAL pg_catalog.aclexplode(
                    coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
                ) acl
                WHERE p.oid = v_fn
                  AND acl.grantee = 0
                  AND acl.privilege_type = 'EXECUTE'
           ) THEN
            RAISE EXCEPTION 'Signed-persistence RPC % has an unsafe or missing execute boundary', v_fn;
        END IF;
    END LOOP;

    -- The EVM signed transaction must persist its full immutable transfer intent.
    SELECT pg_catalog.pg_get_functiondef(v_evm) INTO v_definition;
    IF pg_catalog.strpos(v_definition, 'signed_asset_code') = 0
       OR pg_catalog.strpos(v_definition, 'signed_token_contract') = 0
       OR pg_catalog.strpos(v_definition, 'signed_recipient') = 0
       OR pg_catalog.strpos(v_definition, 'signed_amount_raw') = 0
       OR pg_catalog.strpos(v_definition, 'signed_chain_id') = 0
       OR pg_catalog.strpos(v_definition, 'READY_TO_BROADCAST') = 0
       OR pg_catalog.strpos(v_definition, 'ACTIVE_LEASE_REQUIRED') = 0 THEN
        RAISE EXCEPTION 'EVM signed-persistence RPC is missing its immutable intent, active-lease or state-transition guards';
    END IF;

    -- The BTC/LTC RPC must prove input totals and bind every input to the
    -- active reservation set before it marks a sweep READY_TO_BROADCAST.
    SELECT pg_catalog.pg_get_functiondef(v_btc_ltc) INTO v_definition;
    IF pg_catalog.strpos(v_definition, 'p_signed_utxo_intent') = 0
       OR pg_catalog.strpos(v_definition, 'value_sat') = 0
       OR pg_catalog.strpos(v_definition, 'v_input_total') = 0
       OR pg_catalog.strpos(v_definition, 'v_reserved_count') = 0
       OR pg_catalog.strpos(v_definition, 'v_matched_count') = 0
       OR pg_catalog.strpos(v_definition, 'destination_script_hex') = 0
       OR pg_catalog.strpos(v_definition, 'fee_amount_sat') = 0
       OR pg_catalog.strpos(v_definition, 'READY_TO_BROADCAST') = 0 THEN
        RAISE EXCEPTION 'BTC/LTC signed-persistence RPC is missing intent, value-sum or active-reservation checks';
    END IF;

    -- All EVM intent columns and the BTC/LTC reserved previous-output value
    -- must exist before the signing APIs can preserve the intended transaction.
    FOR v_column_table, v_column_name IN
        SELECT required.table_name, required.column_name
        FROM (VALUES
            ('sweep_operations', 'signed_asset_code'),
            ('sweep_operations', 'signed_token_contract'),
            ('sweep_operations', 'signed_recipient'),
            ('sweep_operations', 'signed_amount_raw'),
            ('sweep_operations', 'signed_chain_id'),
            ('sweep_operations', 'signed_utxo_intent'),
            ('utxo_reservations', 'value_sat')
        ) AS required(table_name, column_name)
    LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns c
            WHERE c.table_schema = 'public'
              AND c.table_name = v_column_table
              AND c.column_name = v_column_name
        ) THEN
            RAISE EXCEPTION 'Required signed-sweep column public.%.% is missing', v_column_table, v_column_name;
        END IF;
    END LOOP;

    IF v_reserve IS NULL
       OR NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc p
            WHERE p.oid = v_reserve
              AND p.prosecdef IS TRUE
              AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
              AND 'search_path=""' = ANY(coalesce(p.proconfig, ARRAY[]::text[]))
       )
       OR NOT pg_catalog.has_function_privilege('service_role', v_reserve, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_reserve, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_reserve, 'EXECUTE')
       OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc p
            CROSS JOIN LATERAL pg_catalog.aclexplode(
                coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
            ) acl
            WHERE p.oid = v_reserve
              AND acl.grantee = 0
              AND acl.privilege_type = 'EXECUTE'
       ) THEN
        RAISE EXCEPTION 'Value-bound UTXO reservation RPC must be postgres-owned, empty-path and service-role-only';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(v_reserve) INTO v_definition;
    IF pg_catalog.strpos(v_definition, 'value_sat') = 0
       OR pg_catalog.strpos(v_definition, 'v_value') = 0 THEN
        RAISE EXCEPTION 'UTXO reservation RPC does not persist independently verified previous-output values';
    END IF;

    FOREACH v_trigger_pair SLICE 1 IN ARRAY v_required_triggers
    LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_trigger t
            JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relname = v_trigger_pair[1]
              AND t.tgname = v_trigger_pair[2]
              AND NOT t.tgisinternal
              AND t.tgenabled <> 'D'
        ) THEN
            RAISE EXCEPTION 'Required enabled signed-sweep integrity trigger %.% is missing',
                v_trigger_pair[1], v_trigger_pair[2];
        END IF;
    END LOOP;

    FOREACH v_trigger_fn IN ARRAY v_trigger_functions
    LOOP
        IF v_trigger_fn IS NULL
           OR NOT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_proc p
                WHERE p.oid = v_trigger_fn
                  AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
                  AND 'search_path=""' = ANY(coalesce(p.proconfig, ARRAY[]::text[]))
           )
           OR pg_catalog.has_function_privilege('anon', v_trigger_fn, 'EXECUTE')
           OR pg_catalog.has_function_privilege('authenticated', v_trigger_fn, 'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role', v_trigger_fn, 'EXECUTE')
           OR EXISTS (
                SELECT 1
                FROM pg_catalog.pg_proc p
                CROSS JOIN LATERAL pg_catalog.aclexplode(
                    coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
                ) acl
                WHERE p.oid = v_trigger_fn
                  AND acl.grantee = 0
                  AND acl.privilege_type = 'EXECUTE'
           ) THEN
            RAISE EXCEPTION 'Signed-sweep trigger function % must be postgres-owned, empty-path and application-inaccessible', v_trigger_fn;
        END IF;
    END LOOP;

    RAISE NOTICE 'PASS: EVM and BTC/LTC signed intent, UTXO value binding, immutable payload triggers and worker RPC grants are aligned';
END;
$preflight$;
