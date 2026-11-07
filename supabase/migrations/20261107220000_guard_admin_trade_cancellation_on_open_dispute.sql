-- A privileged administrator must not use the generic cancellation RPC
-- to refund paid/disputed escrow outside a single open dispute.
-- The canonical dispute resolver remains the only installed function caller.
BEGIN;

DO $dependencies$
DECLARE
    v_cancel regprocedure := to_regprocedure('public.cancel_p2p_trade(uuid,uuid,text)');
    v_resolver regprocedure := to_regprocedure('public.resolve_trade_dispute(uuid,text,uuid,uuid)');
    v_wrapper regprocedure := to_regprocedure('public.admin_resolve_trade_dispute_atomic(uuid,uuid,uuid,uuid,text,text)');
    v_definition text;
BEGIN
    IF v_cancel IS NULL OR v_resolver IS NULL OR v_wrapper IS NULL THEN
        RAISE EXCEPTION 'Canonical cancel/dispute resolver and atomic admin wrapper RPCs are required';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        WHERE p.oid=v_cancel
          AND p.prosecdef IS TRUE
          AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
          AND 'search_path=""' = ANY(coalesce(p.proconfig,ARRAY[]::text[]))
    ) OR NOT pg_catalog.has_function_privilege('service_role',v_cancel,'EXECUTE')
       OR pg_catalog.has_function_privilege('anon',v_cancel,'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated',v_cancel,'EXECUTE') THEN
        RAISE EXCEPTION 'Canonical cancellation function ownership, path or grants changed';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        WHERE p.oid=v_resolver
          AND p.prosecdef IS TRUE
          AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
          AND 'search_path=""' = ANY(coalesce(p.proconfig,ARRAY[]::text[]))
    ) OR pg_catalog.has_function_privilege('service_role',v_resolver,'EXECUTE')
       OR pg_catalog.has_function_privilege('anon',v_resolver,'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated',v_resolver,'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('postgres',v_resolver,'EXECUTE') THEN
        RAISE EXCEPTION 'Inner dispute resolver must remain postgres-only behind the atomic admin wrapper';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        WHERE p.oid=v_wrapper
          AND p.prosecdef IS TRUE
          AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
          AND 'search_path=""' = ANY(coalesce(p.proconfig,ARRAY[]::text[]))
    ) OR NOT pg_catalog.has_function_privilege('service_role',v_wrapper,'EXECUTE')
       OR pg_catalog.has_function_privilege('anon',v_wrapper,'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated',v_wrapper,'EXECUTE') THEN
        RAISE EXCEPTION 'Atomic admin dispute wrapper must remain server-only';
    END IF;

    -- Preserve the single trusted internal caller. If another database
    -- function begins invoking cancellation, audit it before changing policy.
    IF (
        SELECT count(*)
        FROM pg_catalog.pg_proc caller
        JOIN pg_catalog.pg_namespace n ON n.oid=caller.pronamespace
        WHERE n.nspname='public'
          AND caller.oid<>v_cancel
          AND position('public.cancel_p2p_trade(' in caller.prosrc)>0
    ) <> 1 OR NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc caller
        JOIN pg_catalog.pg_namespace n ON n.oid=caller.pronamespace
        WHERE n.nspname='public'
          AND caller.oid=v_resolver
          AND position('public.cancel_p2p_trade(' in caller.prosrc)>0
    ) THEN
        RAISE EXCEPTION 'Unexpected database callers of canonical cancellation RPC';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(v_cancel) INTO v_definition;
    IF pg_catalog.strpos(v_definition,'IF NOT v_is_admin THEN')=0
       OR pg_catalog.strpos(v_definition,'v_is_paid')=0
       OR pg_catalog.strpos(v_definition,'v_is_disputed')=0 THEN
        RAISE EXCEPTION 'Cancellation authorization block changed; refusing a blind patch';
    END IF;
END;
$dependencies$;

-- Enforce the same single-open-dispute invariant against concurrent dispute
-- creation. The cancellation RPC's COUNT check alone is not a concurrency guard.
DO $open_dispute_index_precheck$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.disputes
        WHERE status = 'open'::public.dispute_status
        GROUP BY trade_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Duplicate open disputes exist for a trade; reconcile them before adding the unique invariant';
    END IF;
END;
$open_dispute_index_precheck$;

CREATE UNIQUE INDEX IF NOT EXISTS disputes_one_open_per_trade_uidx
    ON public.disputes (trade_id)
    WHERE status = 'open'::public.dispute_status AND trade_id IS NOT NULL;

DO $patch$
DECLARE
    v_oid regprocedure := to_regprocedure('public.cancel_p2p_trade(uuid,uuid,text)');
    v_definition text;
    v_original text;
    v_old_declaration text := '    v_is_admin BOOLEAN := FALSE;';
    v_new_declaration text := E'    v_is_admin BOOLEAN := FALSE;\n    v_open_dispute_count INTEGER := 0;';
    v_old_block text := $old$
    -- 5. Non-Admin Security Guards: Strict Cancellation Prohibitions
    IF NOT v_is_admin THEN
        IF (v_effective_caller::TEXT <> v_trade.buyer_id::TEXT) AND (v_effective_caller::TEXT <> v_trade.seller_id::TEXT) THEN
            RAISE EXCEPTION 'Unauthorized: only trade participants or an authorized admin can cancel trade %.', p_trade_id;
        END IF;

        IF v_is_disputed THEN
            RAISE EXCEPTION 'Cannot cancel trade % while a dispute is active. Only an authorized admin can resolve a disputed trade.', p_trade_id;
        END IF;

        IF v_is_paid THEN
            RAISE EXCEPTION 'Cannot cancel trade % after payment has been marked or sent. Post-payment trades must be released or resolved via dispute.', p_trade_id;
        END IF;
    END IF;
$old$;
    v_new_block text := $new$
    -- 5. Participant and administrator cancellation guards.
    IF NOT v_is_admin THEN
        IF (v_effective_caller::TEXT <> v_trade.buyer_id::TEXT)
           AND (v_effective_caller::TEXT <> v_trade.seller_id::TEXT) THEN
            RAISE EXCEPTION 'Unauthorized: only trade participants or an authorized admin can cancel trade %.', p_trade_id;
        END IF;

        IF v_is_disputed THEN
            RAISE EXCEPTION 'Cannot cancel trade % while a dispute is active. Only an authorized admin can resolve a disputed trade.', p_trade_id;
        END IF;

        IF v_is_paid THEN
            RAISE EXCEPTION 'Cannot cancel trade % after payment has been marked or sent. Post-payment trades must be released or resolved via dispute.', p_trade_id;
        END IF;
    ELSE
        -- Admin cancellation of paid/disputed escrow is a dispute settlement,
        -- not an alternate refund endpoint. Require exactly one open dispute.
        SELECT COUNT(*)
          INTO v_open_dispute_count
          FROM public.disputes
         WHERE trade_id = p_trade_id
           AND LOWER(status::text) = 'open';

        IF (v_is_paid OR v_is_disputed) AND v_open_dispute_count <> 1 THEN
            RAISE EXCEPTION 'Administrator cancellation of paid/disputed escrow requires exactly one open dispute.'
                USING ERRCODE = '42501',
                      DETAIL = 'ADMIN_CANCEL_REQUIRES_SINGLE_OPEN_DISPUTE';
        END IF;
    END IF;
$new$;
    v_position integer;
BEGIN
    SELECT pg_catalog.pg_get_functiondef(v_oid) INTO v_definition;
    v_original := v_definition;
    v_definition := pg_catalog.replace(v_definition,E'\r\n',E'\n');

    v_position := pg_catalog.strpos(v_definition,v_old_declaration);
    IF v_position=0
       OR pg_catalog.strpos(
            pg_catalog.substr(v_definition,v_position+pg_catalog.length(v_old_declaration)),
            v_old_declaration
          )<>0 THEN
        RAISE EXCEPTION 'Could not uniquely locate cancellation admin declaration';
    END IF;
    v_definition := pg_catalog.replace(v_definition,v_old_declaration,v_new_declaration);

    v_position := pg_catalog.strpos(v_definition,v_old_block);
    IF v_position=0
       OR pg_catalog.strpos(
            pg_catalog.substr(v_definition,v_position+pg_catalog.length(v_old_block)),
            v_old_block
          )<>0 THEN
        RAISE EXCEPTION 'Could not uniquely locate cancellation participant/admin guard block';
    END IF;
    v_definition := pg_catalog.replace(v_definition,v_old_block,v_new_block);

    IF pg_catalog.strpos(v_definition,'v_open_dispute_count INTEGER := 0')=0
       OR pg_catalog.strpos(v_definition,'ADMIN_CANCEL_REQUIRES_SINGLE_OPEN_DISPUTE')=0
       OR pg_catalog.strpos(v_definition,'exactly one open dispute')=0 THEN
        RAISE EXCEPTION 'Cancellation dispute guard patch verification failed';
    END IF;

    EXECUTE v_definition;
END;
$patch$;

ALTER FUNCTION public.cancel_p2p_trade(uuid,uuid,text)
    SET search_path = '';

COMMENT ON FUNCTION public.cancel_p2p_trade(uuid,uuid,text) IS
    'Canonical participant cancellation and seller refund RPC. Paid/disputed escrow may be cancelled by an active admin only when exactly one dispute is open; ordinary participant cancellation remains pre-payment only.';

NOTIFY pgrst, 'reload schema';

COMMIT;
