-- Read-only preflight for sweeper lease ownership and gas-funding worker fencing.
-- Run after the corresponding worker-lease and gas-funding migrations.
DO $preflight$
DECLARE
    v_sig regprocedure;
    v_definition TEXT;
BEGIN
    FOREACH v_sig IN ARRAY ARRAY[
        to_regprocedure('public.claim_next_deposit_sweep(text,integer)'),
        to_regprocedure('public.verify_sweep_ownership(uuid,text,text)'),
        to_regprocedure('public.extend_sweep_lease(uuid,text,integer)'),
        to_regprocedure('public.claim_gas_funding_operation(uuid,text,text,numeric,text)'),
        to_regprocedure('public.update_gas_funding_operation_status(uuid,text,text,text,text)')
    ]::regprocedure[] LOOP
        IF v_sig IS NULL THEN
            RAISE EXCEPTION 'Required sweeper lease/gas-funding RPC is missing';
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc p
            WHERE p.oid = v_sig
              AND p.prosecdef
              AND coalesce(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=""']
        ) THEN
            RAISE EXCEPTION 'RPC % must be SECURITY DEFINER with an empty search_path', v_sig;
        END IF;

        IF NOT has_function_privilege('service_role', v_sig, 'EXECUTE')
           OR has_function_privilege('anon', v_sig, 'EXECUTE')
           OR has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
            RAISE EXCEPTION 'RPC % has an unsafe or missing execution grant', v_sig;
        END IF;
    END LOOP;

    v_definition := pg_catalog.pg_get_functiondef(
        'public.claim_next_deposit_sweep(text,integer)'::regprocedure
    );
    IF position('p_lease_duration_seconds < 30' in v_definition) = 0
       OR position('p_lease_duration_seconds > 1800' in v_definition) = 0
       OR position('FOR UPDATE SKIP LOCKED' in v_definition) = 0
       OR position('lease_expires_at IS NULL' in v_definition) = 0 THEN
        RAISE EXCEPTION 'Sweep claim does not enforce bounded leases and locked expired-lease reclamation';
    END IF;

    v_definition := pg_catalog.pg_get_functiondef(
        'public.verify_sweep_ownership(uuid,text,text)'::regprocedure
    );
    IF position('FOR UPDATE' in v_definition) = 0
       OR position('worker_id = p_worker_id' in v_definition) = 0
       OR position('lease_expires_at IS NOT NULL' in v_definition) = 0
       OR position('lease_expires_at >' in v_definition) = 0
       OR position('OWNERSHIP_CHANGED' in v_definition) = 0 THEN
        RAISE EXCEPTION 'Ownership verification is not row-locked and conditionally fenced to the current worker';
    END IF;

    v_definition := pg_catalog.pg_get_functiondef(
        'public.extend_sweep_lease(uuid,text,integer)'::regprocedure
    );
    IF position('p_extend_seconds < 30' in v_definition) = 0
       OR position('p_extend_seconds > 1800' in v_definition) = 0
       OR position('lease_expires_at IS NOT NULL' in v_definition) = 0
       OR position('worker_id = p_worker_id' in v_definition) = 0 THEN
        RAISE EXCEPTION 'Sweep heartbeat does not enforce bounded, live, owner-matched lease renewal';
    END IF;

    v_definition := pg_catalog.pg_get_functiondef(
        'public.claim_gas_funding_operation(uuid,text,text,numeric,text)'::regprocedure
    );
    IF position('GAS_FUNDED' in v_definition) = 0
       OR position('SET worker_id = p_worker_id' in v_definition) = 0
       OR position('lease_expires_at IS NULL' in v_definition) = 0 THEN
        RAISE EXCEPTION 'Gas-funding claim does not adopt durable operations under the new active parent lease';
    END IF;

    v_definition := pg_catalog.pg_get_functiondef(
        'public.update_gas_funding_operation_status(uuid,text,text,text,text)'::regprocedure
    );
    IF position('v_gas.worker_id IS DISTINCT FROM p_worker_id' in v_definition) = 0
       OR position('GAS_FUNDED' in v_definition) = 0
       OR position('funding_receipt_confirmations' in v_definition) = 0
       OR position('lease_expires_at IS NULL' in v_definition) = 0 THEN
        RAISE EXCEPTION 'Gas-funding status transitions are not fenced to the current parent and child owner/finality';
    END IF;

    RAISE NOTICE 'PASS: sweep claims, heartbeats, ownership verification, and gas-funding writes are fenced to the current worker lease';
END;
$preflight$;
