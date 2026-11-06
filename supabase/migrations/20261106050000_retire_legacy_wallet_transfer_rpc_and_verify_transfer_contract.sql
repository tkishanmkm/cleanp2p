-- Retire the obsolete wallet-transfer RPC and enforce the canonical
-- configured-fee / transfer-receipt database contract.
-- The predecessor migration 20261105220000 reconciles app_settings and
-- patches execute_internal_transfer before this migration runs.
BEGIN;

DO $precheck$
DECLARE
    v_definition text;
BEGIN
    IF to_regprocedure('public.execute_wallet_transfer(uuid,uuid,text,numeric,numeric,text)') IS NULL THEN
        RAISE EXCEPTION 'Expected legacy execute_wallet_transfer RPC is missing; refusing a partial retirement.';
    END IF;

    IF to_regprocedure('public.execute_internal_transfer(uuid,text,text,numeric,text)') IS NULL THEN
        RAISE EXCEPTION 'Canonical execute_internal_transfer RPC is missing.';
    END IF;

    SELECT pg_get_functiondef(
        'public.execute_internal_transfer(uuid,text,text,numeric,text)'::regprocedure
    )
    INTO v_definition;

    IF position('v_recipient_amount := ROUND(p_gross_amount, 8)' IN v_definition) = 0
       OR position('v_fee_amount := ROUND(v_recipient_amount * v_fee_rate, 8)' IN v_definition) = 0
       OR position('v_total_deduction := v_recipient_amount + v_fee_amount' IN v_definition) = 0
       OR position('''total_deduction'', v_total_deduction' IN v_definition) = 0
       OR position('''legacy_fee_model''' IN v_definition) = 0
       OR position('''idempotent_replay''' IN v_definition) = 0
       OR position('public.app_settings' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'Canonical transfer receipt/fee contract is not installed; apply 20261105220000 first.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE oid = 'public.execute_internal_transfer(uuid,text,text,numeric,text)'::regprocedure
          AND prosecdef IS TRUE
          AND proconfig @> ARRAY['search_path=pg_catalog']::text[]
    ) THEN
        RAISE EXCEPTION 'Canonical transfer RPC must use SECURITY DEFINER with search_path=pg_catalog.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname='public'
          AND tablename='transfers'
          AND indexname='transfers_sender_id_idempotency_key_unique'
          AND indexdef ILIKE '%UNIQUE%'
    ) THEN
        RAISE EXCEPTION 'Unique sender/idempotency-key index is required before retiring the legacy transfer RPC.';
    END IF;
END;
$precheck$;

-- The application has no callers for this obsolete routine. It updates legacy
-- balances/profiles tables rather than the canonical wallet_assets + transfers
-- + ledger_entries contract and has no request fingerprint or durable receipt.
REVOKE ALL ON FUNCTION public.execute_wallet_transfer(uuid,uuid,text,numeric,numeric,text)
    FROM PUBLIC, anon, authenticated, service_role;

DO $verify$
BEGIN
    IF has_function_privilege('public', 'public.execute_wallet_transfer(uuid,uuid,text,numeric,numeric,text)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.execute_wallet_transfer(uuid,uuid,text,numeric,numeric,text)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.execute_wallet_transfer(uuid,uuid,text,numeric,numeric,text)', 'EXECUTE')
       OR has_function_privilege('service_role', 'public.execute_wallet_transfer(uuid,uuid,text,numeric,numeric,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'Legacy execute_wallet_transfer remains executable by an API role.';
    END IF;

    IF NOT has_function_privilege('service_role', 'public.execute_internal_transfer(uuid,text,text,numeric,text)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.execute_internal_transfer(uuid,text,text,numeric,text)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.execute_internal_transfer(uuid,text,text,numeric,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'Canonical execute_internal_transfer grants do not match the server-only contract.';
    END IF;

    RAISE NOTICE 'PASS: legacy wallet transfer RPC retired; canonical configured-fee transfer contract and server-only grant preserved.';
END;
$verify$;

COMMIT;
