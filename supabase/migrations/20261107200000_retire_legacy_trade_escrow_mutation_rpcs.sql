-- Retire obsolete escrow mutation RPCs that bypass the canonical trade
-- state machine and ledger. Canonical release/cancel/dispute paths remain active.
BEGIN;

DO $dependencies$
DECLARE
    v_cancel regprocedure := to_regprocedure(
        'public.cancel_trade_and_release_escrow(uuid,text)'
    );
    v_refund regprocedure := to_regprocedure(
        'public.refund_trade_escrow_to_seller(uuid,uuid,text)'
    );
    v_complete regprocedure := to_regprocedure('public.complete_trade(uuid)');
    v_wrapper regprocedure := to_regprocedure(
        'public.admin_resolve_trade_dispute_atomic(uuid,uuid,uuid,uuid,text,text)'
    );
    v_resolver regprocedure := to_regprocedure(
        'public.resolve_trade_dispute(uuid,text,uuid,uuid)'
    );
    v_caller_count integer;
    v_definition text;
BEGIN
    IF v_cancel IS NULL OR v_refund IS NULL OR v_complete IS NULL THEN
        RAISE EXCEPTION 'Expected legacy cancel/refund/complete escrow RPC signature is missing';
    END IF;

    IF v_wrapper IS NULL OR v_resolver IS NULL THEN
        RAISE EXCEPTION 'Atomic admin dispute settlement migration must be installed before legacy escrow RPC retirement';
    END IF;

    IF NOT pg_catalog.has_function_privilege('service_role',v_wrapper,'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role',v_resolver,'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('postgres',v_resolver,'EXECUTE') THEN
        RAISE EXCEPTION 'Atomic dispute wrapper/inner resolver grants do not match the server-only settlement contract';
    END IF;

    IF pg_catalog.has_function_privilege('service_role',
          'public.release_trade_escrow(uuid,uuid)','EXECUTE') IS NOT TRUE
       OR pg_catalog.has_function_privilege('service_role',
          'public.cancel_p2p_trade(uuid,uuid,text)','EXECUTE') IS NOT TRUE THEN
        RAISE EXCEPTION 'Canonical release/cancel settlement RPCs are not available';
    END IF;

    -- Confirm the exact legacy bodies are still installed. If a future deploy
    -- replaces one with a canonical implementation, do not retire it by name.
    SELECT pg_catalog.pg_get_functiondef(v_cancel) INTO v_definition;
    IF pg_catalog.strpos(v_definition,'public.wallets')=0
       OR pg_catalog.strpos(v_definition,'1.015')=0
       OR pg_catalog.strpos(v_definition,'public.wallet_assets')=0 THEN
        RAISE EXCEPTION 'Legacy cancel RPC body changed; re-audit before retiring it';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(v_refund) INTO v_definition;
    IF pg_catalog.strpos(v_definition,'public.wallets')=0
       OR pg_catalog.strpos(v_definition,'public.financial_ledger')=0
       OR pg_catalog.strpos(v_definition,'p_admin_id')=0 THEN
        RAISE EXCEPTION 'Legacy admin refund RPC body changed; re-audit before retiring it';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(v_complete) INTO v_definition;
    IF pg_catalog.strpos(v_definition,'auth.uid()')=0
       OR pg_catalog.strpos(v_definition,'asset_code')=0
       OR pg_catalog.strpos(v_definition,'locked_escrow')=0 THEN
        RAISE EXCEPTION 'Legacy complete_trade RPC body changed; re-audit before retiring it';
    END IF;

    -- These three RPCs are not referenced by any installed public function.
    -- Their only remaining TypeScript definitions are unused wrappers; all
    -- active release/cancel/dispute routes use the canonical server RPCs.
    FOREACH v_cancel IN ARRAY ARRAY[v_cancel,v_refund,v_complete]::regprocedure[] LOOP
        SELECT count(*) INTO v_caller_count
        FROM pg_catalog.pg_proc caller
        JOIN pg_catalog.pg_namespace n ON n.oid=caller.pronamespace
        WHERE n.nspname='public'
          AND caller.oid<>v_cancel
          AND position(
              (SELECT proname FROM pg_catalog.pg_proc WHERE oid=v_cancel) || '('
              IN caller.prosrc
          )>0;

        IF v_caller_count <> 0 THEN
            RAISE EXCEPTION 'Legacy escrow function % has an installed database caller; refusing retirement',
                v_cancel;
        END IF;
    END LOOP;

    -- The previous forward migration must have retired the legacy admin
    -- dispute resolver before this migration narrows the other entry points.
    IF pg_catalog.has_function_privilege(
        'service_role','public.admin_resolve_dispute(uuid,uuid,text,text)','EXECUTE'
    ) THEN
        RAISE EXCEPTION 'Legacy admin_resolve_dispute is still directly executable; apply legacy admin escrow retirement first';
    END IF;
END;
$dependencies$;

-- These functions used legacy balance/ledger schemas and have no active callers.
-- Preserve only postgres execution for any future database-internal cleanup.
REVOKE ALL ON FUNCTION public.cancel_trade_and_release_escrow(uuid,text)
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION public.refund_trade_escrow_to_seller(uuid,uuid,text)
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION public.complete_trade(uuid)
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION public.cancel_trade_and_release_escrow(uuid,text) TO postgres;
GRANT EXECUTE ON FUNCTION public.refund_trade_escrow_to_seller(uuid,uuid,text) TO postgres;
GRANT EXECUTE ON FUNCTION public.complete_trade(uuid) TO postgres;

COMMENT ON FUNCTION public.cancel_trade_and_release_escrow(uuid,text) IS
    'Retired legacy cancellation routine. It uses obsolete wallet accounting; use cancel_p2p_trade through the canonical server-side flow.';
COMMENT ON FUNCTION public.refund_trade_escrow_to_seller(uuid,uuid,text) IS
    'Retired legacy admin refund routine. It uses obsolete wallets/financial_ledger accounting; use atomic admin dispute settlement.';
COMMENT ON FUNCTION public.complete_trade(uuid) IS
    'Retired legacy trade completion routine. Use release_trade_escrow through the canonical server-side route.';

NOTIFY pgrst, 'reload schema';

COMMIT;
