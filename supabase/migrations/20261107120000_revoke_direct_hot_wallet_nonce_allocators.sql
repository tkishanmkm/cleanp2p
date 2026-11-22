-- Generic hot-wallet nonce helpers are internal implementation details.
-- Application workers must allocate through operation-bound withdrawal/gas RPCs.
BEGIN;

DO $dependencies$
DECLARE
    v_withdrawal_allocator regprocedure :=
        to_regprocedure('public.allocate_onchain_withdrawal_nonce(uuid,text,text,text,bigint)');
BEGIN
    IF to_regprocedure('public.allocate_hot_wallet_nonce(integer)') IS NULL
       OR to_regprocedure('public.allocate_hot_wallet_nonce(text,text,bigint)') IS NULL THEN
        RAISE EXCEPTION 'Required generic hot-wallet nonce helper overloads are missing';
    END IF;

    IF v_withdrawal_allocator IS NULL
       OR NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc p
            WHERE p.oid = v_withdrawal_allocator
              AND p.prosecdef IS TRUE
              AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
              AND 'search_path=""' = ANY(coalesce(p.proconfig, ARRAY[]::text[]))
       )
       OR pg_catalog.strpos(
            pg_catalog.pg_get_functiondef(v_withdrawal_allocator),
            'public.allocate_hot_wallet_nonce('
          ) = 0 THEN
        RAISE EXCEPTION 'Operation-bound withdrawal allocator cannot securely invoke the internal nonce helper';
    END IF;
END;
$dependencies$;

-- Pin both SECURITY DEFINER helpers to an empty path. Their bodies use
-- schema-qualified public objects and the operation-bound caller has postgres
-- as its SECURITY DEFINER owner.
ALTER FUNCTION public.allocate_hot_wallet_nonce(integer)
    SET search_path = '';
ALTER FUNCTION public.allocate_hot_wallet_nonce(text, text, bigint)
    SET search_path = '';

-- Remove direct calls by every API/runtime role, including service_role.
-- Preserve only postgres execution for nested SECURITY DEFINER calls.
REVOKE ALL ON FUNCTION public.allocate_hot_wallet_nonce(integer)
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION public.allocate_hot_wallet_nonce(text, text, bigint)
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION public.allocate_hot_wallet_nonce(integer)
    TO postgres;
GRANT EXECUTE ON FUNCTION public.allocate_hot_wallet_nonce(text, text, bigint)
    TO postgres;

COMMENT ON FUNCTION public.allocate_hot_wallet_nonce(integer) IS
    'Internal-only hot-wallet nonce counter primitive. Use operation-bound withdrawal/gas-funding RPCs; direct API execution is revoked.';
COMMENT ON FUNCTION public.allocate_hot_wallet_nonce(text, text, bigint) IS
    'Internal-only hot-wallet nonce counter primitive. Use operation-bound withdrawal/gas-funding RPCs; direct API execution is revoked.';

NOTIFY pgrst, 'reload schema';

COMMIT;
