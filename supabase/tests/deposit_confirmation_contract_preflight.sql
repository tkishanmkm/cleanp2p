-- Read-only post-apply verification for the canonical deposit registration/confirmation lease contract.
DO $check$
DECLARE
    v_register regprocedure :=
      to_regprocedure('public.register_pending_deposit(text,text,text,numeric,text,integer,bigint,text,text,integer,text)');
    v_claim regprocedure :=
      to_regprocedure('public.claim_pending_deposit_confirmations(text,integer,integer)');
    v_release regprocedure :=
      to_regprocedure('public.release_pending_deposit_confirmation_claim(uuid,text)');
    v_confirm regprocedure :=
      to_regprocedure('public.process_deposit_atomic_with_lease(uuid,text,text,text,text,numeric,text,integer,bigint,text,text,integer,text)');
    v_credit regprocedure :=
      to_regprocedure('public.process_deposit_atomic(text,text,text,numeric,text,integer,bigint,text,text,integer,text)');
    v_register_def text;
    v_claim_def text;
    v_release_def text;
    v_confirm_def text;
    v_credit_def text;
BEGIN
    IF to_regclass('public.onchain_deposits') IS NULL
       OR v_register IS NULL
       OR v_claim IS NULL
       OR v_release IS NULL
       OR v_confirm IS NULL
       OR v_credit IS NULL THEN
        RAISE EXCEPTION 'FAIL: canonical deposit confirmation tables or RPC signatures are missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'onchain_deposits'
          AND column_name = 'confirmation_worker_id'
          AND data_type = 'text'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'onchain_deposits'
          AND column_name = 'confirmation_lease_expires_at'
          AND data_type = 'timestamp with time zone'
    ) THEN
        RAISE EXCEPTION 'FAIL: deposit confirmation lease columns are missing or have incorrect types';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'onchain_deposits'
          AND indexname = 'idx_onchain_deposits_confirmation_claim'
    ) THEN
        RAISE EXCEPTION 'FAIL: pending deposit claim index is missing';
    END IF;

    SELECT pg_get_functiondef(v_register) INTO v_register_def;
    SELECT pg_get_functiondef(v_claim) INTO v_claim_def;
    SELECT pg_get_functiondef(v_release) INTO v_release_def;
    SELECT pg_get_functiondef(v_confirm) INTO v_confirm_def;
    SELECT pg_get_functiondef(v_credit) INTO v_credit_def;

    IF position('p_confirmations IS DISTINCT FROM 0' IN v_register_def) = 0
       OR position('public.process_deposit_atomic' IN v_register_def) = 0 THEN
        RAISE EXCEPTION 'FAIL: pending registration must accept only zero-confirmation candidates and delegate to the canonical RPC';
    END IF;

    IF position('v_effective_confirmations := COALESCE(p_confirmations, 0)' IN v_credit_def) = 0
       OR position('v_effective_confirmations >= v_required_confirmations' IN v_credit_def) = 0 THEN
        RAISE EXCEPTION 'FAIL: canonical credit must base its confirmation decision on the submitted verification count and the network threshold';
    END IF;

    IF position('FOR UPDATE SKIP LOCKED' IN v_claim_def) = 0
       OR position('confirmation_worker_id = p_owner_token' IN v_claim_def) = 0
       OR position('confirmation_lease_expires_at' IN v_claim_def) = 0 THEN
        RAISE EXCEPTION 'FAIL: deposit claiming is missing row-lock, owner-token or lease-expiry fencing';
    END IF;

    IF position('confirmation_worker_id = p_owner_token' IN v_release_def) = 0
       OR position('confirmation_worker_id = NULL' IN v_release_def) = 0 THEN
        RAISE EXCEPTION 'FAIL: claim release is not bound to the original worker token';
    END IF;

    IF position('v_deposit.confirmation_worker_id IS DISTINCT FROM p_lease_token' IN v_confirm_def) = 0
       OR position('v_deposit.confirmation_lease_expires_at <= pg_catalog.clock_timestamp()' IN v_confirm_def) = 0
       OR position('v_deposit.amount IS DISTINCT FROM p_amount' IN v_confirm_def) = 0
       OR position('v_deposit.output_index IS DISTINCT FROM p_output_index' IN v_confirm_def) = 0
       OR position('public.process_deposit_atomic' IN v_confirm_def) = 0 THEN
        RAISE EXCEPTION 'FAIL: leased credit wrapper is missing lease-expiry or exact-deposit-identity checks';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE oid = v_register
          AND prosecdef IS TRUE
          AND proconfig @> ARRAY['search_path=""']::text[]
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE oid = v_claim
          AND prosecdef IS TRUE
          AND proconfig @> ARRAY['search_path=""']::text[]
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE oid = v_release
          AND prosecdef IS TRUE
          AND proconfig @> ARRAY['search_path=""']::text[]
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE oid = v_confirm
          AND prosecdef IS TRUE
          AND proconfig @> ARRAY['search_path=""']::text[]
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE oid = v_credit
          AND prosecdef IS TRUE
          AND proconfig @> ARRAY['search_path=pg_catalog']::text[]
    ) THEN
        RAISE EXCEPTION 'FAIL: deposit SECURITY DEFINER RPC search_path settings are not hardened';
    END IF;

    IF has_function_privilege('public', v_register, 'EXECUTE')
       OR has_function_privilege('anon', v_register, 'EXECUTE')
       OR has_function_privilege('authenticated', v_register, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_register, 'EXECUTE')
       OR has_function_privilege('public', v_claim, 'EXECUTE')
       OR has_function_privilege('anon', v_claim, 'EXECUTE')
       OR has_function_privilege('authenticated', v_claim, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_claim, 'EXECUTE')
       OR has_function_privilege('public', v_release, 'EXECUTE')
       OR has_function_privilege('anon', v_release, 'EXECUTE')
       OR has_function_privilege('authenticated', v_release, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_release, 'EXECUTE')
       OR has_function_privilege('public', v_confirm, 'EXECUTE')
       OR has_function_privilege('anon', v_confirm, 'EXECUTE')
       OR has_function_privilege('authenticated', v_confirm, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_confirm, 'EXECUTE')
       OR has_function_privilege('public', v_credit, 'EXECUTE')
       OR has_function_privilege('anon', v_credit, 'EXECUTE')
       OR has_function_privilege('authenticated', v_credit, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_credit, 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL: deposit RPC execution grants do not match the server-only contract';
    END IF;

    RAISE NOTICE 'PASS: pending registration is zero-confirmation only; claim, lease, identity and server-only credit boundaries are present';
END;
$check$;
