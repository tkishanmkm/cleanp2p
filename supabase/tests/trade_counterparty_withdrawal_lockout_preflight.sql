-- Read-only post-apply verification for trade participant withdrawal lockouts.
DO $check$
DECLARE
    v_definition text;
    v_guard_position integer;
    v_caller_freeze_position integer;
BEGIN
    IF to_regprocedure('public.initiate_trade_with_escrow(text,numeric,numeric,text,numeric,text,text,text,uuid)') IS NULL THEN
        RAISE EXCEPTION 'FAIL: canonical trade RPC is missing';
    END IF;

    SELECT pg_get_functiondef(
        'public.initiate_trade_with_escrow(text,numeric,numeric,text,numeric,text,text,text,uuid)'::regprocedure
    )
    INTO v_definition;

    v_guard_position := position('COUNTERPARTY_WITHDRAWAL_APPROVAL_PENDING' IN v_definition);
    v_caller_freeze_position := position('IF v_caller_frozen THEN' IN v_definition);

    IF v_guard_position = 0
       OR v_caller_freeze_position = 0
       OR v_guard_position >= v_caller_freeze_position THEN
        RAISE EXCEPTION 'FAIL: the counterparty withdrawal guard is missing or was not placed after profile locks';
    END IF;

    IF position('public.has_pending_withdrawal_approval(v_effective_caller)' IN v_definition) = 0
       OR position('public.has_pending_withdrawal_approval(v_ad_user_id)' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'FAIL: both trade participants are not checked for pending withdrawal approval';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE oid = 'public.has_pending_withdrawal_approval(uuid)'::regprocedure
          AND prosecdef IS TRUE
          AND proconfig @> ARRAY['search_path=""']::text[]
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE oid = 'public.get_user_kyc_tier(uuid)'::regprocedure
          AND prosecdef IS TRUE
          AND proconfig @> ARRAY['search_path=""']::text[]
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE oid = 'public.get_user_cumulative_buy_volume(uuid)'::regprocedure
          AND prosecdef IS TRUE
          AND proconfig @> ARRAY['search_path=""']::text[]
    ) THEN
        RAISE EXCEPTION 'FAIL: a nested SECURITY DEFINER trade helper does not use an empty search_path';
    END IF;

    IF has_function_privilege('anon', 'public.has_pending_withdrawal_approval(uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.has_pending_withdrawal_approval(uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.get_user_kyc_tier(uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.get_user_kyc_tier(uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.get_user_cumulative_buy_volume(uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.get_user_cumulative_buy_volume(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL: a nested privileged trade helper is exposed to browser roles';
    END IF;

    RAISE NOTICE 'PASS: caller and counterparty withdrawal approval locks are enforced after profile locks; nested helper search paths are empty';
END;
$check$;
