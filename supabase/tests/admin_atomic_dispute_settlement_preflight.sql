-- Read-only post-apply verification for the atomic administrator dispute settlement RPC.
DO $check$
DECLARE
    v_wrapper regprocedure :=
      to_regprocedure('public.admin_resolve_trade_dispute_atomic(uuid,uuid,uuid,uuid,text,text)');
    v_resolver regprocedure :=
      to_regprocedure('public.resolve_trade_dispute(uuid,text,uuid,uuid)');
    v_wrapper_def text;
    v_resolver_def text;
BEGIN
    IF v_wrapper IS NULL OR v_resolver IS NULL THEN
        RAISE EXCEPTION 'FAIL: atomic admin dispute wrapper or canonical resolver is missing.';
    END IF;

    IF to_regclass('public.admin_audit_logs') IS NULL
       OR to_regclass('public.disputes') IS NULL
       OR to_regclass('public.trades') IS NULL
       OR to_regclass('public.trade_messages') IS NULL
       OR to_regclass('public.notifications') IS NULL THEN
        RAISE EXCEPTION 'FAIL: required dispute settlement or audit tables are missing.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='admin_audit_logs'
          AND column_name='admin_id' AND data_type='uuid'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='admin_audit_logs'
          AND column_name='action' AND data_type='character varying'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='admin_audit_logs'
          AND column_name='target_id' AND data_type='character varying'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='admin_audit_logs'
          AND column_name='target_user_id' AND data_type='uuid'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='admin_audit_logs'
          AND column_name='details' AND data_type='jsonb'
    ) THEN
        RAISE EXCEPTION 'FAIL: admin_audit_logs schema does not match the atomic settlement audit insert.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='trade_messages'
          AND column_name='trade_id' AND data_type='text'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='trade_messages'
          AND column_name='sender_id' AND data_type='text'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='trade_messages'
          AND column_name='sender_username' AND data_type='text'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='trade_messages'
          AND column_name='message' AND data_type='character varying'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='trade_messages'
          AND column_name='is_moderator' AND data_type='boolean'
    ) THEN
        RAISE EXCEPTION 'FAIL: trade_messages schema does not match the optional dispute system-message insert.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='disputes'
          AND column_name='winner_id' AND data_type='uuid'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='disputes'
          AND column_name='resolved_by' AND data_type='uuid'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='trades'
          AND column_name='is_disputed' AND data_type='boolean'
    ) THEN
        RAISE EXCEPTION 'FAIL: dispute/trade terminal-state columns required by the settlement wrapper are missing.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE oid = 'public.is_active_admin_identity(uuid)'::regprocedure
          AND prosecdef IS TRUE
          AND proconfig @> ARRAY['search_path=""']::text[]
    ) THEN
        RAISE EXCEPTION 'FAIL: current active-admin identity predicate is missing or not hardened.';
    END IF;

    SELECT pg_get_functiondef(v_wrapper) INTO v_wrapper_def;
    SELECT pg_get_functiondef(v_resolver) INTO v_resolver_def;

    IF position('COALESCE(auth.role(), '''') <> ''service_role''' IN v_wrapper_def) = 0
       OR position('public.is_active_admin_identity(p_actor_id)' IN v_wrapper_def) = 0
       OR position('FOR UPDATE' IN v_wrapper_def) = 0
       OR position('public.resolve_trade_dispute' IN v_wrapper_def) = 0
       OR position('ADMIN_RESOLVED_TRADE_DISPUTE' IN v_wrapper_def) = 0
       OR position('settlement_succeeded' IN v_wrapper_def) = 0
       OR position('audit_logged' IN v_wrapper_def) = 0 THEN
        RAISE EXCEPTION 'FAIL: atomic wrapper is missing trusted-caller, active-admin, row-lock, canonical-settlement or mandatory-audit guards.';
    END IF;

    IF position('public.is_active_admin_identity(v_effective_caller)' IN v_resolver_def) = 0 THEN
        RAISE EXCEPTION 'FAIL: inner canonical resolver is not bound to the active administrator identity.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE oid = v_wrapper
          AND prosecdef IS TRUE
          AND proconfig @> ARRAY['search_path=""']::text[]
          AND pg_get_userbyid(proowner) = 'postgres'
    ) THEN
        RAISE EXCEPTION 'FAIL: atomic wrapper must be SECURITY DEFINER, owned by postgres, with an empty search_path.';
    END IF;

    IF has_function_privilege('anon', v_wrapper, 'EXECUTE')
       OR has_function_privilege('authenticated', v_wrapper, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_wrapper, 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL: atomic wrapper grants do not match the server-only contract.';
    END IF;

    IF has_function_privilege('anon', v_resolver, 'EXECUTE')
       OR has_function_privilege('authenticated', v_resolver, 'EXECUTE')
       OR has_function_privilege('service_role', v_resolver, 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL: the inner dispute resolver is still directly executable by browser or service roles.';
    END IF;

    IF NOT has_function_privilege('service_role', 'public.release_trade_escrow(uuid,uuid)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.cancel_p2p_trade(uuid,uuid,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL: canonical financial settlement RPCs lost required service-role grants.';
    END IF;

    RAISE NOTICE 'PASS: atomic dispute settlement RPC uses active-admin identity, locks dispute/trade, settles through canonical financial RPCs, records mandatory audit, and is server-only.';
END;
$check$;
