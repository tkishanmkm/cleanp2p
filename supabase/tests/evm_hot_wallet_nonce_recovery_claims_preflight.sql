-- Structural and privilege preflight for shared EVM nonce recovery fencing.
-- Read-only: no synthetic deposits, withdrawals, nonces, receipts or balances.
DO $preflight$
DECLARE
    v_helper regprocedure := to_regprocedure(
        'public.evm_hot_wallet_nonce_recovery_allowed(text,text,bigint,uuid,uuid)'
    );
    v_gas_trigger_fn regprocedure := to_regprocedure(
        'public.resolve_evm_gas_funding_nonce_incident_from_receipt()'
    );
    v_claim_def text;
    v_gas_claim_def text;
    v_proof_def text;
    v_withdrawal_incident_def text;
    v_gas_incident_def text;
    v_gas_trigger_def text;
BEGIN
    IF v_helper IS NULL OR v_gas_trigger_fn IS NULL THEN
        RAISE EXCEPTION 'Shared EVM nonce recovery helper/trigger function missing';
    END IF;

    IF to_regclass('public.onchain_withdrawal_nonce_incidents') IS NULL
       OR to_regclass('public.evm_gas_funding_nonce_incidents') IS NULL
       OR to_regclass('public.onchain_withdrawal_receipt_proofs') IS NULL
       OR to_regclass('public.onchain_withdrawal_nonce_reservations') IS NULL THEN
        RAISE EXCEPTION 'Required nonce incident, reservation or receipt proof table missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid = v_helper
          AND p.prosecdef IS TRUE
          AND 'search_path=""' = ANY(coalesce(p.proconfig, ARRAY[]::text[]))
    ) THEN
        RAISE EXCEPTION 'Nonce recovery helper must be SECURITY DEFINER with an empty search_path';
    END IF;

    IF pg_catalog.has_function_privilege('anon', v_helper, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_helper, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_helper, 'EXECUTE')
       OR pg_catalog.has_function_privilege('supabase_auth_admin', v_helper, 'EXECUTE')
       OR EXISTS (
           SELECT 1
           FROM pg_catalog.pg_proc p
           CROSS JOIN LATERAL pg_catalog.aclexplode(
               coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
           ) acl
           WHERE p.oid = v_helper
             AND acl.grantee = 0
             AND acl.privilege_type = 'EXECUTE'
       ) THEN
        RAISE EXCEPTION 'Internal nonce recovery helper is executable by an untrusted role';
    END IF;

    IF NOT pg_catalog.has_function_privilege('postgres', v_helper, 'EXECUTE') THEN
        RAISE EXCEPTION 'Function owner cannot execute internal nonce recovery helper';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(
        'public.claim_pending_withdrawals(integer,text)'::regprocedure
    ) INTO v_claim_def;
    SELECT pg_catalog.pg_get_functiondef(
        'public.claim_gas_funding_operation(uuid,text,text,numeric,text)'::regprocedure
    ) INTO v_gas_claim_def;
    SELECT pg_catalog.pg_get_functiondef(
        'public.record_evm_withdrawal_receipt_proof(uuid,text,text,smallint,integer,bigint,text,bigint,text,integer,numeric,numeric)'::regprocedure
    ) INTO v_proof_def;
    SELECT pg_catalog.pg_get_functiondef(
        'public.record_evm_withdrawal_nonce_incident(uuid,text,text,bigint,text,bigint,bigint,text)'::regprocedure
    ) INTO v_withdrawal_incident_def;
    SELECT pg_catalog.pg_get_functiondef(
        'public.record_evm_gas_funding_nonce_incident(uuid,text,text,bigint,text,bigint,bigint,text)'::regprocedure
    ) INTO v_gas_incident_def;
    SELECT pg_catalog.pg_get_functiondef(v_gas_trigger_fn) INTO v_gas_trigger_def;

    IF pg_catalog.strpos(v_claim_def, 'evm_hot_wallet_nonce_recovery_allowed') = 0
       OR pg_catalog.strpos(v_claim_def, 'onchain_withdrawal_nonce_reservations') = 0
       OR pg_catalog.strpos(v_claim_def, 'own.status') = 0 THEN
        RAISE EXCEPTION 'Withdrawal recovery candidate does not require a matching durable nonce reservation and sequence gate';
    END IF;

    IF pg_catalog.strpos(v_gas_claim_def, 'evm_hot_wallet_nonce_recovery_allowed') = 0
       OR pg_catalog.strpos(v_gas_claim_def, 'v_gas.funding_wallet_address') = 0
       OR pg_catalog.strpos(v_gas_claim_def, '55P03') = 0 THEN
        RAISE EXCEPTION 'Gas-funding exact-byte recovery does not enforce the shared nonce sequence';
    END IF;

    IF pg_catalog.strpos(v_proof_def, 'UPDATE public.onchain_withdrawal_nonce_incidents') = 0
       OR pg_catalog.strpos(v_proof_def, 'CANONICAL_SUCCESS_RECEIPT') = 0
       OR pg_catalog.strpos(v_proof_def, 'CANONICAL_REVERT_RECEIPT') = 0
       OR pg_catalog.strpos(v_proof_def, 'resolved_by = ''canonical_receipt_proof''') = 0 THEN
        RAISE EXCEPTION 'Persisted canonical withdrawal receipt does not atomically resolve its matching incident';
    END IF;

    IF pg_catalog.strpos(v_withdrawal_incident_def, 'SET status = ''OPEN''') = 0
       OR pg_catalog.strpos(v_withdrawal_incident_def, 'resolved_at = NULL') = 0 THEN
        RAISE EXCEPTION 'Withdrawal nonce incidents cannot reopen after a later canonicality-loss observation';
    END IF;

    IF pg_catalog.strpos(v_gas_incident_def, 'SET status = ''OPEN''') = 0
       OR pg_catalog.strpos(v_gas_incident_def, 'resolved_at = NULL') = 0 THEN
        RAISE EXCEPTION 'Gas-funding nonce incidents cannot reopen after a later canonicality-loss observation';
    END IF;

    IF pg_catalog.strpos(v_gas_trigger_def, 'UPDATE public.evm_gas_funding_nonce_incidents') = 0
       OR pg_catalog.strpos(v_gas_trigger_def, 'funding_receipt_confirmations') = 0
       OR pg_catalog.strpos(v_gas_trigger_def, 'CANONICAL_REVERT_RECEIPT') = 0 THEN
        RAISE EXCEPTION 'Canonical gas-funding receipt does not resolve its matching nonce incident';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid = 'public.gas_funding_operations'::regclass
          AND t.tgname = 'trg_resolve_evm_gas_funding_nonce_incident_from_receipt'
          AND NOT t.tgisinternal
    ) THEN
        RAISE EXCEPTION 'Gas-funding canonical receipt incident resolver trigger missing';
    END IF;
END;
$preflight$;
