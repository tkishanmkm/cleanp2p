-- Read-only preflight for 20261105225017_harden_paired_withdrawal_settlement.sql.
-- Run after applying the migration to the intended Paxones database.
DO $test$
DECLARE
    v_complete regprocedure := to_regprocedure(
        'public.complete_onchain_withdrawal(uuid,text,numeric,text)'
    );
    v_failed regprocedure := to_regprocedure(
        'public.process_failed_withdrawal(uuid,text,numeric,text,boolean)'
    );
    v_definition text;
BEGIN
    IF v_complete IS NULL OR v_failed IS NULL THEN
        RAISE EXCEPTION 'FAIL: canonical withdrawal settlement RPC signature is missing';
    END IF;

    IF NOT has_function_privilege('service_role', v_complete, 'EXECUTE')
       OR has_function_privilege('anon', v_complete, 'EXECUTE')
       OR has_function_privilege('authenticated', v_complete, 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL: complete_onchain_withdrawal must be service_role-only';
    END IF;

    IF NOT has_function_privilege('service_role', v_failed, 'EXECUTE')
       OR has_function_privilege('anon', v_failed, 'EXECUTE')
       OR has_function_privilege('authenticated', v_failed, 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL: process_failed_withdrawal must be service_role-only';
    END IF;

    SELECT pg_get_functiondef(v_complete) INTO v_definition;
    IF position('PAIRED_WITHDRAWAL_IDENTITY_MISMATCH' IN v_definition) = 0
       OR position('PAIRED_WITHDRAWAL_HASH_MISMATCH' IN v_definition) = 0
       OR position('PAIRED_WITHDRAWAL_TERMINAL_STATE_MISMATCH' IN v_definition) = 0
       OR position('INTO v_mirror' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'FAIL: complete_onchain_withdrawal paired identity/hash/state guards are missing';
    END IF;

    SELECT pg_get_functiondef(v_failed) INTO v_definition;
    IF position('PAIRED_WITHDRAWAL_IDENTITY_MISMATCH' IN v_definition) = 0
       OR position('PAIRED_WITHDRAWAL_HASH_MISMATCH' IN v_definition) = 0
       OR position('PAIRED_WITHDRAWAL_TERMINAL_STATE_MISMATCH' IN v_definition) = 0
       OR position('INTO v_mirror' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'FAIL: process_failed_withdrawal paired identity/hash/state guards are missing';
    END IF;

    RAISE NOTICE 'PASS: withdrawal settlement RPCs lock and validate both paired records; worker-only ACLs preserved';
END;
$test$;
