-- Read-only grants/RLS preflight for hot-wallet and sweep state tables.
DO $preflight$
DECLARE
    v_table regclass;
    v_rpc regprocedure;
    v_expected_rpcs regprocedure[] := ARRAY[
        to_regprocedure('public.claim_next_deposit_sweep(text,integer)'),
        to_regprocedure('public.claim_gas_funding_operation(uuid,text,text,numeric,text)'),
        to_regprocedure('public.allocate_onchain_withdrawal_nonce(uuid,text,text,text,bigint)'),
        to_regprocedure('public.update_gas_funding_operation_status(uuid,text,text,text,text)'),
        to_regprocedure('public.update_sweep_operation_status(uuid,text,text,text,text,numeric,text,integer)'),
        to_regprocedure('public.persist_signed_gas_funding(uuid,text,text,text,bigint,numeric,numeric)')
    ];
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'public.hot_wallet_nonces'::regclass,
        'public.gas_funding_operations'::regclass,
        'public.sweep_operations'::regclass
    ] LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_class c
            WHERE c.oid = v_table
              AND c.relrowsecurity IS TRUE
        ) THEN
            RAISE EXCEPTION 'RLS must remain enabled on %', v_table;
        END IF;

        IF pg_catalog.has_table_privilege('anon', v_table, 'SELECT')
           OR pg_catalog.has_table_privilege('anon', v_table, 'INSERT')
           OR pg_catalog.has_table_privilege('anon', v_table, 'UPDATE')
           OR pg_catalog.has_table_privilege('anon', v_table, 'DELETE')
           OR pg_catalog.has_table_privilege('authenticated', v_table, 'SELECT')
           OR pg_catalog.has_table_privilege('authenticated', v_table, 'INSERT')
           OR pg_catalog.has_table_privilege('authenticated', v_table, 'UPDATE')
           OR pg_catalog.has_table_privilege('authenticated', v_table, 'DELETE') THEN
            RAISE EXCEPTION 'Browser roles retain direct access to %', v_table;
        END IF;
    END LOOP;

    IF pg_catalog.has_table_privilege('service_role', 'public.hot_wallet_nonces', 'SELECT')
       OR pg_catalog.has_table_privilege('service_role', 'public.hot_wallet_nonces', 'INSERT')
       OR pg_catalog.has_table_privilege('service_role', 'public.hot_wallet_nonces', 'UPDATE')
       OR pg_catalog.has_table_privilege('service_role', 'public.hot_wallet_nonces', 'DELETE')
       OR pg_catalog.has_table_privilege('service_role', 'public.hot_wallet_nonces', 'TRUNCATE') THEN
        RAISE EXCEPTION 'service_role retains direct access to hot_wallet_nonces';
    END IF;

    FOREACH v_table IN ARRAY ARRAY[
        'public.gas_funding_operations'::regclass,
        'public.sweep_operations'::regclass
    ] LOOP
        IF NOT pg_catalog.has_table_privilege('service_role', v_table, 'SELECT')
           OR pg_catalog.has_table_privilege('service_role', v_table, 'INSERT')
           OR pg_catalog.has_table_privilege('service_role', v_table, 'UPDATE')
           OR pg_catalog.has_table_privilege('service_role', v_table, 'DELETE')
           OR pg_catalog.has_table_privilege('service_role', v_table, 'TRUNCATE')
           OR pg_catalog.has_table_privilege('service_role', v_table, 'REFERENCES')
           OR pg_catalog.has_table_privilege('service_role', v_table, 'TRIGGER') THEN
            RAISE EXCEPTION 'service_role access to % must be SELECT-only', v_table;
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('hot_wallet_nonces', 'gas_funding_operations', 'sweep_operations')
    ) THEN
        RAISE EXCEPTION 'Worker tables must not retain broad direct-access RLS policies';
    END IF;

    FOREACH v_rpc IN ARRAY v_expected_rpcs LOOP
        IF v_rpc IS NULL OR NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc p
            WHERE p.oid = v_rpc
              AND p.prosecdef IS TRUE
              AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
        ) THEN
            RAISE EXCEPTION 'Required postgres-owned SECURITY DEFINER worker RPC missing: %',
                coalesce(v_rpc::text, 'unknown signature');
        END IF;
        IF NOT pg_catalog.has_function_privilege('service_role', v_rpc, 'EXECUTE') THEN
            RAISE EXCEPTION 'service_role cannot execute required worker RPC: %', v_rpc;
        END IF;
    END LOOP;
END;
$preflight$;
