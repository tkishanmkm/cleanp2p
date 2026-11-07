-- Read-only ACL, internal-caller and KYC-enforcement preflight.
DO $preflight$
DECLARE
    v_primary_trade regprocedure := to_regprocedure(
        'public.initiate_trade_with_escrow(text,numeric,numeric,text,numeric,text,text,text,uuid)'
    );
    v_primary_transfer regprocedure := to_regprocedure(
        'public.execute_internal_transfer(uuid,text,text,numeric,text)'
    );
    v_legacy_trade regprocedure := to_regprocedure(
        'public.initiate_p2p_trade(uuid,uuid,uuid,numeric,text,numeric,numeric,text,text)'
    );
    v_kyc regprocedure := to_regprocedure('public.get_user_kyc_tier(uuid)');
    v_cumulative regprocedure := to_regprocedure('public.get_user_cumulative_buy_volume(uuid)');
    v_my_kyc regprocedure := to_regprocedure('public.get_my_kyc_info()');
    v_remaining regprocedure := to_regprocedure('public.get_user_remaining_buy_allowance(uuid)');
    v_helper regprocedure;
    v_definition text;
BEGIN
    FOREACH v_helper IN ARRAY ARRAY[
        v_kyc,v_cumulative,v_my_kyc,v_remaining,v_legacy_trade
    ]::regprocedure[] LOOP
        IF v_helper IS NULL OR NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_proc p
            WHERE p.oid=v_helper
              AND p.prosecdef IS TRUE
              AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
              AND 'search_path=""' = ANY(coalesce(p.proconfig,ARRAY[]::text[]))
        ) THEN
            RAISE EXCEPTION 'KYC/legacy helper % is not postgres-owned SECURITY DEFINER with empty search_path',v_helper;
        END IF;

        IF pg_catalog.has_function_privilege('anon',v_helper,'EXECUTE')
           OR pg_catalog.has_function_privilege('authenticated',v_helper,'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role',v_helper,'EXECUTE')
           OR pg_catalog.has_function_privilege('supabase_auth_admin',v_helper,'EXECUTE')
           OR EXISTS (
                SELECT 1
                FROM pg_catalog.pg_proc p
                CROSS JOIN LATERAL pg_catalog.aclexplode(
                    coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))
                ) acl
                WHERE p.oid=v_helper
                  AND acl.grantee=0
                  AND acl.privilege_type='EXECUTE'
           )
           OR NOT pg_catalog.has_function_privilege('postgres',v_helper,'EXECUTE') THEN
            RAISE EXCEPTION 'KYC/legacy helper % execute grants are not postgres-only',v_helper;
        END IF;
    END LOOP;

    IF v_primary_trade IS NULL OR v_primary_transfer IS NULL THEN
        RAISE EXCEPTION 'A canonical trade/transfer entry point is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid=v_primary_trade
          AND p.prosecdef IS TRUE
          AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
          AND 'search_path=""' = ANY(coalesce(p.proconfig,ARRAY[]::text[]))
    ) OR NOT pg_catalog.has_function_privilege('service_role',v_primary_trade,'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated',v_primary_trade,'EXECUTE')
       OR pg_catalog.has_function_privilege('anon',v_primary_trade,'EXECUTE') THEN
        RAISE EXCEPTION 'Canonical escrow trade RPC lost its guarded role or SECURITY DEFINER contract';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(v_primary_trade) INTO v_definition;
    IF pg_catalog.strpos(v_definition,'v_seller_tier < 2')=0
       OR pg_catalog.strpos(v_definition,'v_buyer_cum_buys + v_trade_usd_amount')=0
       OR pg_catalog.strpos(v_definition,'1000.00')=0 THEN
        RAISE EXCEPTION 'Canonical escrow trade RPC lost seller KYC or Tier 1 cumulative buy cap';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid=v_primary_transfer
          AND p.prosecdef IS TRUE
          AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
          AND 'search_path=""' = ANY(coalesce(p.proconfig,ARRAY[]::text[]))
    ) OR NOT pg_catalog.has_function_privilege('service_role',v_primary_transfer,'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated',v_primary_transfer,'EXECUTE')
       OR pg_catalog.has_function_privilege('anon',v_primary_transfer,'EXECUTE') THEN
        RAISE EXCEPTION 'Canonical internal transfer RPC lost its service-only SECURITY DEFINER contract';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(v_primary_transfer) INTO v_definition;
    IF pg_catalog.strpos(v_definition,'public.get_user_kyc_tier(')=0 THEN
        RAISE EXCEPTION 'Internal transfer RPC no longer runs its own KYC tier gate';
    END IF;
END;
$preflight$;
