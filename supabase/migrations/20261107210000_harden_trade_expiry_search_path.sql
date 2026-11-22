-- Remove writable public/temporary schema lookup from the trade-expiry
-- SECURITY DEFINER worker functions. Preserve their server-only grants.
BEGIN;

DO $dependencies$
DECLARE
    v_batch regprocedure := to_regprocedure('public.cancel_expired_p2p_trades()');
    v_single regprocedure := to_regprocedure('public.expire_p2p_trade(uuid)');
    v_definition text;
BEGIN
    IF v_batch IS NULL OR v_single IS NULL THEN
        RAISE EXCEPTION 'Expected canonical trade-expiry function signatures are missing';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        WHERE p.oid IN (v_batch,v_single)
          AND (
              p.prosecdef IS NOT TRUE
              OR pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres'
          )
    ) THEN
        RAISE EXCEPTION 'Trade-expiry functions must remain postgres-owned SECURITY DEFINER functions';
    END IF;

    IF NOT pg_catalog.has_function_privilege('service_role',v_batch,'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role',v_single,'EXECUTE') THEN
        RAISE EXCEPTION 'Service-role trade-expiry worker grants are missing';
    END IF;

    IF pg_catalog.has_function_privilege('anon',v_batch,'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated',v_batch,'EXECUTE')
       OR pg_catalog.has_function_privilege('anon',v_single,'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated',v_single,'EXECUTE') THEN
        RAISE EXCEPTION 'Browser roles must not be able to invoke trade-expiry functions';
    END IF;

    -- Ensure the batch function still calls the single-trade function, and
    -- both still operate on the canonical trade/wallet/ledger relations.
    SELECT pg_catalog.pg_get_functiondef(v_batch) INTO v_definition;
    IF pg_catalog.strpos(v_definition,'public.expire_p2p_trade(') = 0
       OR pg_catalog.strpos(v_definition,'public.trades') = 0
       OR pg_catalog.strpos(v_definition,'public.disputes') = 0 THEN
        RAISE EXCEPTION 'Batch expiry function body or canonical caller relationship changed';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(v_single) INTO v_definition;
    IF pg_catalog.strpos(v_definition,'public.trades') = 0
       OR pg_catalog.strpos(v_definition,'public.wallet_assets') = 0
       OR pg_catalog.strpos(v_definition,'public.ledger_entries') = 0
       OR pg_catalog.strpos(v_definition,'public.disputes') = 0 THEN
        RAISE EXCEPTION 'Single-trade expiry function is not using the canonical escrow/wallet/ledger tables';
    END IF;
END;
$dependencies$;

ALTER FUNCTION public.cancel_expired_p2p_trades()
    SET search_path = '';
ALTER FUNCTION public.expire_p2p_trade(uuid)
    SET search_path = '';

NOTIFY pgrst, 'reload schema';

COMMIT;
