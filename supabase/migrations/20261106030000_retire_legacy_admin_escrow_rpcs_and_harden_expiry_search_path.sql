-- Retire obsolete admin escrow RPCs that can transition state without the canonical
-- settlement ledger, and harden the service-only expiry RPC search paths.
BEGIN;

DO $precheck$
BEGIN
    IF to_regprocedure('public.admin_refund_escrow(character varying,uuid,text)') IS NULL
       OR to_regprocedure('public.admin_release_escrow(character varying,uuid,text)') IS NULL
       OR to_regprocedure('public.admin_resolve_dispute(uuid,uuid,text,text)') IS NULL THEN
        RAISE EXCEPTION 'Expected legacy admin escrow RPC signatures are missing; refusing a partial retirement.';
    END IF;

    IF to_regprocedure('public.cancel_expired_p2p_trades()') IS NULL
       OR to_regprocedure('public.expire_p2p_trade(uuid)') IS NULL THEN
        RAISE EXCEPTION 'Canonical trade-expiry RPC signatures are missing.';
    END IF;
END;
$precheck$;

-- These legacy routines are not used by the application. In particular,
-- admin_release_escrow only changed trade status; it did not settle wallet
-- balances or create the canonical double-entry ledger entries.
-- admin_resolve_dispute uses the obsolete public.wallets balance model and
-- trusts a profiles.is_admin flag rather than the verified admin identity.
REVOKE ALL ON FUNCTION public.admin_refund_escrow(character varying,uuid,text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_release_escrow(character varying,uuid,text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_resolve_dispute(uuid,uuid,text,text)
    FROM PUBLIC, anon, authenticated, service_role;

-- SECURITY DEFINER expiry functions reference schema-qualified application
-- objects. An empty search_path removes public/temp object shadowing while
-- retaining implicit pg_catalog lookup for built-in functions and operators.
ALTER FUNCTION public.cancel_expired_p2p_trades() SET search_path = '';
ALTER FUNCTION public.expire_p2p_trade(uuid) SET search_path = '';

DO $verify$
BEGIN
    IF has_function_privilege('anon', 'public.admin_refund_escrow(character varying,uuid,text)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.admin_refund_escrow(character varying,uuid,text)', 'EXECUTE')
       OR has_function_privilege('service_role', 'public.admin_refund_escrow(character varying,uuid,text)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.admin_release_escrow(character varying,uuid,text)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.admin_release_escrow(character varying,uuid,text)', 'EXECUTE')
       OR has_function_privilege('service_role', 'public.admin_release_escrow(character varying,uuid,text)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.admin_resolve_dispute(uuid,uuid,text,text)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.admin_resolve_dispute(uuid,uuid,text,text)', 'EXECUTE')
       OR has_function_privilege('service_role', 'public.admin_resolve_dispute(uuid,uuid,text,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'A browser/backend API role can still execute an obsolete admin escrow RPC.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE oid = 'public.cancel_expired_p2p_trades()'::regprocedure
          AND prosecdef IS TRUE
          AND proconfig @> ARRAY['search_path=""']::text[]
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE oid = 'public.expire_p2p_trade(uuid)'::regprocedure
          AND prosecdef IS TRUE
          AND proconfig @> ARRAY['search_path=""']::text[]
    ) THEN
        RAISE EXCEPTION 'Trade-expiry SECURITY DEFINER search_path hardening failed.';
    END IF;

    -- Preserve service-only access to the currently used canonical expiry and
    -- settlement routines.
    IF NOT has_function_privilege('service_role', 'public.cancel_expired_p2p_trades()', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.expire_p2p_trade(uuid)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.release_trade_escrow(uuid,uuid)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.cancel_p2p_trade(uuid,uuid,text)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.resolve_trade_dispute(uuid,text,uuid,uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'Canonical server-side trade settlement/expiry RPC grants changed unexpectedly.';
    END IF;

    RAISE NOTICE 'PASS: obsolete admin escrow RPCs are no longer executable by browser/service roles; canonical expiry functions use an empty search_path and retain service-role access.';
END;
$verify$;

COMMIT;
