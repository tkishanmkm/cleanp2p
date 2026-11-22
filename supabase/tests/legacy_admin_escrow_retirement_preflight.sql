-- Read-only post-apply check for legacy admin escrow retirement and expiry hardening.
DO $check$
BEGIN
    IF to_regprocedure('public.admin_refund_escrow(character varying,uuid,text)') IS NULL
       OR to_regprocedure('public.admin_release_escrow(character varying,uuid,text)') IS NULL
       OR to_regprocedure('public.admin_resolve_dispute(uuid,uuid,text,text)') IS NULL THEN
        RAISE EXCEPTION 'FAIL: expected retired legacy RPC signature is missing.';
    END IF;

    IF has_function_privilege('anon', 'public.admin_refund_escrow(character varying,uuid,text)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.admin_refund_escrow(character varying,uuid,text)', 'EXECUTE')
       OR has_function_privilege('service_role', 'public.admin_refund_escrow(character varying,uuid,text)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.admin_release_escrow(character varying,uuid,text)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.admin_release_escrow(character varying,uuid,text)', 'EXECUTE')
       OR has_function_privilege('service_role', 'public.admin_release_escrow(character varying,uuid,text)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.admin_resolve_dispute(uuid,uuid,text,text)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.admin_resolve_dispute(uuid,uuid,text,text)', 'EXECUTE')
       OR has_function_privilege('service_role', 'public.admin_resolve_dispute(uuid,uuid,text,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL: obsolete admin escrow RPC remains executable by a browser/backend API role.';
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
        RAISE EXCEPTION 'FAIL: expiry function search_path is not hardened.';
    END IF;

    IF NOT has_function_privilege('service_role', 'public.cancel_expired_p2p_trades()', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.expire_p2p_trade(uuid)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.release_trade_escrow(uuid,uuid)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.cancel_p2p_trade(uuid,uuid,text)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.resolve_trade_dispute(uuid,text,uuid,uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL: canonical service-role settlement/expiry access is missing.';
    END IF;

    RAISE NOTICE 'PASS: legacy admin escrow RPCs retired; expiry search_path hardened; canonical server RPC grants preserved.';
END;
$check$;
