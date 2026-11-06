-- Read-only post-apply verification for configured internal-transfer fees/receipts.
DO $check$
DECLARE
    v_definition text;
    v_legacy regprocedure :=
      to_regprocedure('public.execute_wallet_transfer(uuid,uuid,text,numeric,numeric,text)');
    v_canonical regprocedure :=
      to_regprocedure('public.execute_internal_transfer(uuid,text,text,numeric,text)');
    v_fee numeric;
    v_escrow_fee numeric;
    v_min_trade numeric;
BEGIN
    IF v_legacy IS NULL OR v_canonical IS NULL THEN
        RAISE EXCEPTION 'FAIL: expected legacy/canonical transfer RPC signatures are missing.';
    END IF;

    SELECT value::numeric INTO v_fee
      FROM public.app_settings WHERE key='platform_fee_percent';
    SELECT value::numeric INTO v_escrow_fee
      FROM public.app_settings WHERE key='escrow_fee_percent';
    SELECT value::numeric INTO v_min_trade
      FROM public.app_settings WHERE key='min_trade_amount';

    IF v_fee IS NULL OR v_fee < 0 OR v_fee > 10
       OR v_escrow_fee IS NULL OR v_escrow_fee < 0 OR v_escrow_fee > 10
       OR v_min_trade IS NULL OR v_min_trade < 0.01 OR v_min_trade > 1000000 THEN
        RAISE EXCEPTION 'FAIL: authoritative app_settings fee/minimum values are missing or outside supported bounds.';
    END IF;

    SELECT pg_get_functiondef(v_canonical) INTO v_definition;

    IF position('v_recipient_amount := ROUND(p_gross_amount, 8)' IN v_definition) = 0
       OR position('v_fee_amount := ROUND(v_recipient_amount * v_fee_rate, 8)' IN v_definition) = 0
       OR position('v_total_deduction := v_recipient_amount + v_fee_amount' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'FAIL: canonical transfer must credit entered amount and debit amount plus fee.';
    END IF;

    IF position('''gross_amount'', v_recipient_amount' IN v_definition) = 0
       OR position('''net_amount'', v_recipient_amount' IN v_definition) = 0
       OR position('''fee_amount'', v_fee_amount' IN v_definition) = 0
       OR position('''total_deduction'', v_total_deduction' IN v_definition) = 0
       OR position('''legacy_fee_model'', FALSE' IN v_definition) = 0
       OR position('''idempotent_replay'', FALSE' IN v_definition) = 0
       OR position('''idempotent_replay'', TRUE' IN v_definition) = 0
       OR position('''legacy_fee_model''' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'FAIL: transfer success/replay response is incompatible with the API integrity validator.';
    END IF;

    IF position('FROM public.app_settings' IN v_definition) = 0
       OR position('WHERE key = ''platform_fee_percent''' IN v_definition) = 0
       OR position('auth.uid() IS NULL OR auth.uid() <> p_sender_id' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'FAIL: canonical transfer must use authoritative fee config and reject missing/mismatched caller identity.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE oid = v_canonical
          AND prosecdef IS TRUE
          AND proconfig @> ARRAY['search_path=pg_catalog']::text[]
    ) THEN
        RAISE EXCEPTION 'FAIL: canonical transfer SECURITY DEFINER search_path is not pg_catalog.';
    END IF;

    IF has_function_privilege('anon', v_canonical, 'EXECUTE')
       OR has_function_privilege('authenticated', v_canonical, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_canonical, 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL: canonical transfer RPC grants are not server-only.';
    END IF;

    IF has_function_privilege('public', v_legacy, 'EXECUTE')
       OR has_function_privilege('anon', v_legacy, 'EXECUTE')
       OR has_function_privilege('authenticated', v_legacy, 'EXECUTE')
       OR has_function_privilege('service_role', v_legacy, 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL: obsolete execute_wallet_transfer RPC is still executable.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname='public'
          AND tablename='transfers'
          AND indexname='transfers_sender_id_idempotency_key_unique'
          AND indexdef ILIKE '%UNIQUE%'
    ) THEN
        RAISE EXCEPTION 'FAIL: transfer sender/idempotency unique index is missing.';
    END IF;

    RAISE NOTICE 'PASS: authoritative fee values, entered-amount recipient credit, fee-on-top sender debit, success/replay receipt contract, and RPC privileges verified.';
END;
$check$;
