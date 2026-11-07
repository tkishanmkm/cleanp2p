-- Restrict obsolete service-role financial mutation helpers.
-- Canonical app paths use the atomic admin adjustment and internal transfer
-- RPCs; platform ledger writes remain nested inside postgres-owned settlements.
BEGIN;

DO $dependencies$
DECLARE
    v_name text;
    v_helper regprocedure;
    v_count integer;
    v_caller_count integer;
BEGIN
    FOREACH v_name IN ARRAY ARRAY[
        'admin_adjust_balance',
        'ensure_user_balance_wallet',
        'mark_gas_funded',
        'mark_swept',
        'record_platform_ledger_entry'
    ] LOOP
        SELECT count(*) INTO v_count
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = v_name;

        IF v_count = 0 THEN
            RAISE EXCEPTION 'Expected legacy financial helper is missing: %', v_name;
        END IF;
    END LOOP;

    -- Every caller of the ledger helper must be an owner-owned SECURITY
    -- DEFINER settlement function. Direct service-role ledger creation is not
    -- an application contract.
    SELECT count(*) INTO v_caller_count
    FROM pg_catalog.pg_proc caller
    JOIN pg_catalog.pg_namespace n ON n.oid = caller.pronamespace
    WHERE n.nspname = 'public'
      AND position('record_platform_ledger_entry(' in caller.prosrc) > 0;

    IF v_caller_count <> 2 OR EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc caller
        JOIN pg_catalog.pg_namespace n ON n.oid = caller.pronamespace
        WHERE n.nspname = 'public'
          AND position('record_platform_ledger_entry(' in caller.prosrc) > 0
          AND (
              caller.prosecdef IS NOT TRUE
              OR pg_catalog.pg_get_userbyid(caller.proowner) <> 'postgres'
          )
    ) THEN
        RAISE EXCEPTION 'Platform ledger helper callers changed; refusing to revoke service execution';
    END IF;

    -- These reset/legacy helpers have no nested public-function callers.
    FOREACH v_name IN ARRAY ARRAY[
        'admin_adjust_balance',
        'ensure_user_balance_wallet',
        'mark_gas_funded',
        'mark_swept'
    ] LOOP
        IF EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc caller
            JOIN pg_catalog.pg_namespace n ON n.oid = caller.pronamespace
            WHERE n.nspname = 'public'
              AND position(v_name || '(' in caller.prosrc) > 0
        ) THEN
            RAISE EXCEPTION 'Legacy helper % has an installed function caller; refusing ACL retirement', v_name;
        END IF;
    END LOOP;
END;
$dependencies$;

-- All data objects in these helpers are schema-qualified. Pin the functions
-- to pg_catalog-only implicit lookup and leave execute rights with postgres.
DO $retire_helpers$
DECLARE
    v_helper regprocedure;
BEGIN
    FOR v_helper IN
        SELECT p.oid::regprocedure
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
              'admin_adjust_balance',
              'ensure_user_balance_wallet',
              'mark_gas_funded',
              'mark_swept',
              'record_platform_ledger_entry'
          )
        ORDER BY p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)
    LOOP
        IF pg_catalog.pg_get_userbyid(
              (SELECT proowner FROM pg_catalog.pg_proc WHERE oid = v_helper)
           ) <> 'postgres' THEN
            RAISE EXCEPTION 'Legacy financial helper % is not postgres-owned', v_helper;
        END IF;

        EXECUTE pg_catalog.format('ALTER FUNCTION %s SET search_path = %L', v_helper, '');
        EXECUTE pg_catalog.format(
            'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin',
            v_helper
        );
        EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO postgres', v_helper);
    END LOOP;
END;
$retire_helpers$;

-- The API route still uses this canonical server-mediated RPC. Keep service
-- execution, but remove the public/anonymous/authenticated grants and eliminate
-- the writable public/temporary schema search path.
ALTER FUNCTION public.execute_internal_transfer(uuid,text,text,numeric,text)
    SET search_path = '';

REVOKE ALL ON FUNCTION public.execute_internal_transfer(uuid,text,text,numeric,text)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.execute_internal_transfer(uuid,text,text,numeric,text)
    TO service_role, postgres;

NOTIFY pgrst, 'reload schema';

COMMIT;
