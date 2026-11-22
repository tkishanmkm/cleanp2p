-- KYC-tier and cumulative-buy helpers are database-internal decisions.
-- Retire the unused legacy trade wrapper and direct service-role access to
-- helper/read RPCs. Preserve the canonical trade and internal-transfer paths.
BEGIN;

DO $dependencies$
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
    v_callers text[];
    v_definition text;
BEGIN
    IF v_primary_trade IS NULL OR v_primary_transfer IS NULL
       OR v_legacy_trade IS NULL OR v_kyc IS NULL OR v_cumulative IS NULL
       OR v_my_kyc IS NULL OR v_remaining IS NULL THEN
        RAISE EXCEPTION 'Expected canonical trade/transfer, legacy wrapper or KYC helper function is missing';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        WHERE p.oid IN (
            v_primary_trade,v_primary_transfer,v_kyc,v_cumulative,v_my_kyc,v_remaining,v_legacy_trade
        )
          AND (
              p.prosecdef IS NOT TRUE
              OR pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres'
          )
    ) THEN
        RAISE EXCEPTION 'KYC/trade functions must remain postgres-owned SECURITY DEFINER functions';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(v_primary_trade) INTO v_definition;
    IF pg_catalog.strpos(v_definition,'public.get_user_kyc_tier(')=0
       OR pg_catalog.strpos(v_definition,'public.get_user_cumulative_buy_volume(')=0
       OR pg_catalog.strpos(v_definition,'v_seller_tier < 2')=0
       OR pg_catalog.strpos(v_definition,'v_buyer_cum_buys + v_trade_usd_amount')=0
       OR pg_catalog.strpos(v_definition,'1000.00')=0 THEN
        RAISE EXCEPTION 'Canonical trade RPC no longer contains database-enforced seller KYC and Tier 1 cumulative-buy limits';
    END IF;

    -- Pin the direct transfer RPC before removing helper execute rights. It
    -- remains a service-only endpoint and invokes KYC helpers as postgres.
    IF NOT pg_catalog.has_function_privilege('service_role',v_primary_transfer,'EXECUTE') THEN
        RAISE EXCEPTION 'Canonical internal-transfer RPC service grant is missing';
    END IF;

    -- KYC tier is intentionally shared by the canonical trade, canonical
    -- internal-transfer and two KYC-information functions only.
    SELECT coalesce(array_agg(caller.proname ORDER BY caller.proname),ARRAY[]::text[])
      INTO v_callers
    FROM pg_catalog.pg_proc caller
    JOIN pg_catalog.pg_namespace n ON n.oid=caller.pronamespace
    WHERE n.nspname='public'
      AND caller.oid<>v_kyc
      AND position('get_user_kyc_tier(' in caller.prosrc)>0;

    IF v_callers IS DISTINCT FROM ARRAY[
        'execute_internal_transfer',
        'get_my_kyc_info',
        'get_user_remaining_buy_allowance',
        'initiate_trade_with_escrow'
    ]::text[] THEN
        RAISE EXCEPTION 'Unexpected KYC-tier caller graph: %',v_callers;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc caller
        JOIN pg_catalog.pg_namespace n ON n.oid=caller.pronamespace
        WHERE n.nspname='public'
          AND position('get_user_kyc_tier(' in caller.prosrc)>0
          AND (
              caller.prosecdef IS NOT TRUE
              OR pg_catalog.pg_get_userbyid(caller.proowner)<>'postgres'
          )
    ) THEN
        RAISE EXCEPTION 'A KYC-tier caller is not postgres-owned SECURITY DEFINER';
    END IF;

    -- Cumulative volume is used by trade initiation and the two KYC-info
    -- functions. All callers execute as postgres; direct role calls are not
    -- needed for internal invocation.
    SELECT coalesce(array_agg(caller.proname ORDER BY caller.proname),ARRAY[]::text[])
      INTO v_callers
    FROM pg_catalog.pg_proc caller
    JOIN pg_catalog.pg_namespace n ON n.oid=caller.pronamespace
    WHERE n.nspname='public'
      AND caller.oid<>v_cumulative
      AND position('get_user_cumulative_buy_volume(' in caller.prosrc)>0;

    IF v_callers IS DISTINCT FROM ARRAY[
        'get_my_kyc_info',
        'get_user_remaining_buy_allowance',
        'initiate_trade_with_escrow'
    ]::text[] THEN
        RAISE EXCEPTION 'Unexpected cumulative-buy-volume caller graph: %',v_callers;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc caller
        JOIN pg_catalog.pg_namespace n ON n.oid=caller.pronamespace
        WHERE n.nspname='public'
          AND position('get_user_cumulative_buy_volume(' in caller.prosrc)>0
          AND (
              caller.prosecdef IS NOT TRUE
              OR pg_catalog.pg_get_userbyid(caller.proowner)<>'postgres'
          )
    ) THEN
        RAISE EXCEPTION 'A cumulative-buy-volume caller is not postgres-owned SECURITY DEFINER';
    END IF;

    -- The application has moved to initiate_trade_with_escrow. Do not revoke
    -- this wrapper if a database function still invokes it.
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc caller
        JOIN pg_catalog.pg_namespace n ON n.oid=caller.pronamespace
        WHERE n.nspname='public'
          AND caller.oid<>v_legacy_trade
          AND position('initiate_p2p_trade(' in caller.prosrc)>0
    ) THEN
        RAISE EXCEPTION 'Legacy initiate_p2p_trade wrapper still has an installed database caller';
    END IF;

    IF NOT pg_catalog.has_function_privilege('service_role',v_primary_trade,'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated',v_primary_trade,'EXECUTE') THEN
        RAISE EXCEPTION 'Canonical escrow trade RPC access changed; refusing legacy-helper ACL migration';
    END IF;
END;
$dependencies$;

-- Keep all nested SECURITY DEFINER call chains independent of caller-controlled
-- schemas, including the existing internal-transfer KYC check.
ALTER FUNCTION public.get_user_kyc_tier(uuid) SET search_path = '';
ALTER FUNCTION public.get_user_cumulative_buy_volume(uuid) SET search_path = '';
ALTER FUNCTION public.get_user_remaining_buy_allowance(uuid) SET search_path = '';
ALTER FUNCTION public.get_my_kyc_info() SET search_path = '';
ALTER FUNCTION public.initiate_p2p_trade(uuid,uuid,uuid,numeric,text,numeric,numeric,text,text) SET search_path = '';
ALTER FUNCTION public.execute_internal_transfer(uuid,text,text,numeric,text) SET search_path = '';

-- Helpers and unused informational/legacy wrappers are postgres-internal.
REVOKE ALL ON FUNCTION public.get_user_kyc_tier(uuid)
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION public.get_user_cumulative_buy_volume(uuid)
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION public.get_user_remaining_buy_allowance(uuid)
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION public.get_my_kyc_info()
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION public.initiate_p2p_trade(uuid,uuid,uuid,numeric,text,numeric,numeric,text,text)
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION public.get_user_kyc_tier(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_user_cumulative_buy_volume(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_user_remaining_buy_allowance(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_my_kyc_info() TO postgres;
GRANT EXECUTE ON FUNCTION public.initiate_p2p_trade(uuid,uuid,uuid,numeric,text,numeric,numeric,text,text)
    TO postgres;

-- Preserve the two actual application entry points and their caller contracts.
REVOKE ALL ON FUNCTION public.initiate_trade_with_escrow(text,numeric,numeric,text,numeric,text,text,text,uuid)
    FROM PUBLIC, anon, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.initiate_trade_with_escrow(text,numeric,numeric,text,numeric,text,text,text,uuid)
    TO authenticated, service_role, postgres;

REVOKE ALL ON FUNCTION public.execute_internal_transfer(uuid,text,text,numeric,text)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.execute_internal_transfer(uuid,text,text,numeric,text)
    TO service_role, postgres;

COMMENT ON FUNCTION public.get_user_kyc_tier(uuid) IS
    'Internal KYC tier resolver invoked only by postgres-owned trade, internal-transfer and KYC-information functions.';
COMMENT ON FUNCTION public.get_user_cumulative_buy_volume(uuid) IS
    'Internal cumulative USD buy-volume calculator invoked only by postgres-owned trade and KYC-information functions; fails closed when historical valuation is unavailable.';
COMMENT ON FUNCTION public.get_user_remaining_buy_allowance(uuid) IS
    'Internal KYC allowance calculation; direct API execution is revoked.';
COMMENT ON FUNCTION public.get_my_kyc_info() IS
    'Internal KYC information aggregator; direct API execution is revoked.';
COMMENT ON FUNCTION public.initiate_p2p_trade(uuid,uuid,uuid,numeric,text,numeric,numeric,text,text) IS
    'Retired legacy trade-initiation wrapper. Direct application execution is revoked; use initiate_trade_with_escrow.';
COMMENT ON FUNCTION public.execute_internal_transfer(uuid,text,text,numeric,text) IS
    'Canonical service-only wallet transfer RPC; derives KYC eligibility internally and uses an empty search_path.';

NOTIFY pgrst, 'reload schema';

COMMIT;
