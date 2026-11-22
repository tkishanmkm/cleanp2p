-- Keep hot-wallet nonce and sweep/gas-funding mutations behind postgres-owned RPCs.
-- The server worker only needs read access to sweep/gas-funding rows; the nonce
-- registry has no direct application read path.
BEGIN;

DO $dependencies$
DECLARE
    v_required regprocedure;
BEGIN
    IF to_regclass('public.hot_wallet_nonces') IS NULL
       OR to_regclass('public.gas_funding_operations') IS NULL
       OR to_regclass('public.sweep_operations') IS NULL THEN
        RAISE EXCEPTION 'Required hot-wallet/sweeper tables are missing';
    END IF;

    FOREACH v_required IN ARRAY ARRAY[
        to_regprocedure('public.claim_next_deposit_sweep(text,integer)'),
        to_regprocedure('public.claim_gas_funding_operation(uuid,text,text,numeric,text)'),
        to_regprocedure('public.allocate_onchain_withdrawal_nonce(uuid,text,text,text,bigint)'),
        to_regprocedure('public.update_gas_funding_operation_status(uuid,text,text,text,text)'),
        to_regprocedure('public.update_sweep_operation_status(uuid,text,text,text,text,numeric,text,integer)'),
        to_regprocedure('public.persist_signed_gas_funding(uuid,text,text,text,bigint,numeric,numeric)')
    ]::regprocedure[] LOOP
        IF v_required IS NULL OR NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc p
            WHERE p.oid = v_required
              AND p.prosecdef IS TRUE
              AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
        ) THEN
            RAISE EXCEPTION 'Required postgres-owned SECURITY DEFINER worker RPC is missing or unsafe: %',
                coalesce(v_required::text, 'unknown signature');
        END IF;

        IF NOT pg_catalog.has_function_privilege('service_role', v_required, 'EXECUTE') THEN
            RAISE EXCEPTION 'Service role cannot execute required worker RPC: %', v_required;
        END IF;
    END LOOP;
END;
$dependencies$;

-- Remove permissive service-role RLS policies. SECURITY DEFINER functions owned
-- by postgres continue to bypass RLS because FORCE ROW LEVEL SECURITY is not set.
DROP POLICY IF EXISTS "Enable all access for service role on hot_wallet_nonces"
    ON public.hot_wallet_nonces;
DROP POLICY IF EXISTS "Service role full access to gas_funding_operations"
    ON public.gas_funding_operations;
DROP POLICY IF EXISTS "Service role full access to sweep_operations"
    ON public.sweep_operations;

-- No API role may query or mutate the nonce counter directly.
REVOKE ALL PRIVILEGES ON TABLE public.hot_wallet_nonces
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Workers retain SELECT only for the read-only reconciliation/recovery queries
-- in sweeperWorker.ts. All writes continue through the checked RPCs above.
REVOKE ALL PRIVILEGES ON TABLE public.gas_funding_operations
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL PRIVILEGES ON TABLE public.sweep_operations
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT SELECT ON TABLE public.gas_funding_operations TO service_role;
GRANT SELECT ON TABLE public.sweep_operations TO service_role;

COMMENT ON TABLE public.hot_wallet_nonces IS
    'Private per-chain hot-wallet nonce registry. Mutation and reads are restricted to postgres-owned SECURITY DEFINER RPCs.';
COMMENT ON TABLE public.gas_funding_operations IS
    'Gas-funding operations. service_role has read-only access; all mutations require worker-lease and receipt-aware postgres-owned RPCs.';
COMMENT ON TABLE public.sweep_operations IS
    'Deposit sweep operations. service_role has read-only access; all mutations require worker-lease and signed-transaction-aware postgres-owned RPCs.';

NOTIFY pgrst, 'reload schema';

COMMIT;
