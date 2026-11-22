-- Read-only contract preflight for the shared EVM hot-wallet nonce stream.
-- Run after the EVM gas-funding, withdrawal nonce, and receipt migrations.
DO $preflight$
DECLARE
    v_sig regprocedure;
    v_definition text;
    v_constraint text;
    v_required_columns text[] := ARRAY[
        'funding_wallet_address',
        'actual_funding_tx_gas_used',
        'actual_funding_tx_effective_gas_price',
        'actual_funding_tx_fee',
        'funding_receipt_status',
        'funding_receipt_block_number',
        'funding_receipt_block_hash',
        'funding_receipt_confirmations'
    ];
    v_column text;
BEGIN
    -- Every allocator and recovery RPC must exist with a pinned, service-only contract.
    FOREACH v_sig IN ARRAY ARRAY[
        to_regprocedure('public.allocate_deposit_address_nonce(uuid,text,bigint)'),
        to_regprocedure('public.allocate_gas_funding_nonce(uuid,text,text,text,bigint)'),
        to_regprocedure('public.allocate_onchain_withdrawal_nonce(uuid,text,text,text,bigint)'),
        to_regprocedure('public.persist_signed_gas_funding(uuid,text,text,text,bigint,numeric,numeric)'),
        to_regprocedure('public.record_evm_gas_funding_receipt(uuid,text,text,smallint,integer,numeric,numeric,bigint,text)'),
        to_regprocedure('public.mark_evm_gas_funding_receipt_recovery_required(uuid,text,text,text)'),
        to_regprocedure('public.record_evm_gas_funding_nonce_incident(uuid,text,text,bigint,text,bigint,bigint,text)'),
        to_regprocedure('public.record_evm_withdrawal_nonce_incident(uuid,text,text,bigint,text,bigint,bigint,text)')
    ]::regprocedure[] LOOP
        IF v_sig IS NULL THEN
            RAISE EXCEPTION 'Required shared EVM nonce RPC is missing';
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_proc p
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

    -- The receipt RPC without confirmation evidence must be retired.
    IF to_regprocedure('public.record_evm_gas_funding_receipt(uuid,text,text,smallint,numeric,numeric,bigint,text)') IS NOT NULL THEN
        RAISE EXCEPTION 'Legacy gas receipt RPC without confirmation evidence remains executable';
    END IF;

    -- Old generic nonce allocators must no longer be available to service workers.
    IF to_regprocedure('public.allocate_hot_wallet_nonce(integer)') IS NULL
       OR to_regprocedure('public.allocate_hot_wallet_nonce(text,text,bigint)') IS NULL
       OR has_function_privilege('service_role',
            'public.allocate_hot_wallet_nonce(integer)'::regprocedure, 'EXECUTE')
       OR has_function_privilege('service_role',
            'public.allocate_hot_wallet_nonce(text,text,bigint)'::regprocedure, 'EXECUTE') THEN
        RAISE EXCEPTION 'Legacy generic hot-wallet nonce allocators must be revoked from service_role';
    END IF;

    -- The per-chain counter and operation-bound child nonce columns are mandatory.
    IF to_regclass('public.hot_wallet_nonces') IS NULL
       OR to_regclass('public.gas_funding_operations') IS NULL
       OR to_regclass('public.onchain_withdrawal_nonce_reservations') IS NULL THEN
        RAISE EXCEPTION 'Shared hot-wallet nonce tables are missing';
    END IF;

    FOREACH v_column IN ARRAY v_required_columns LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'gas_funding_operations'
              AND column_name = v_column
        ) THEN
            RAISE EXCEPTION 'gas_funding_operations.% is missing', v_column;
        END IF;
    END LOOP;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'hot_wallet_nonces'
          AND column_name IN ('chain_id', 'current_nonce')
        GROUP BY table_name
        HAVING count(DISTINCT column_name) = 2
    ) THEN
        RAISE EXCEPTION 'hot_wallet_nonces must have chain_id and current_nonce';
    END IF;

    -- Database constraints independently prevent shallow receipts from consuming
    -- the nonce stream or allowing a signed operation to be marked FAILED.
    SELECT pg_catalog.pg_get_constraintdef(c.oid)
      INTO v_constraint
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.gas_funding_operations'::regclass
      AND c.conname = 'gas_funding_evm_confirmed_requires_receipt';
    IF v_constraint IS NULL
       OR position('funding_receipt_confirmations IS NOT NULL' in replace(v_constraint, '"', '')) = 0
       OR position('funding_receipt_confirmations' in v_constraint) = 0 THEN
        RAISE EXCEPTION 'EVM CONFIRMED constraint does not enforce non-null receipt confirmation depth';
    END IF;

    SELECT pg_catalog.pg_get_constraintdef(c.oid)
      INTO v_constraint
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.gas_funding_operations'::regclass
      AND c.conname = 'gas_funding_failed_nonce_requires_consumed_receipt';
    IF v_constraint IS NULL
       OR position('funding_receipt_confirmations IS NOT NULL' in replace(v_constraint, '"', '')) = 0
       OR position('funding_receipt_confirmations' in v_constraint) = 0 THEN
        RAISE EXCEPTION 'EVM FAILED constraint does not enforce non-null receipt confirmation depth';
    END IF;

    -- Both operation classes must serialize against each other while holding
    -- the same per-chain hot_wallet_nonces row lock.
    v_definition := pg_catalog.pg_get_functiondef(
        'public.allocate_gas_funding_nonce(uuid,text,text,text,bigint)'::regprocedure
    );
    IF position('onchain_withdrawal_nonce_reservations' in v_definition) = 0
       OR position('hot_wallet_nonces' in v_definition) = 0 THEN
        RAISE EXCEPTION 'Gas-funding allocator is not fenced against unresolved withdrawals';
    END IF;

    v_definition := pg_catalog.pg_get_functiondef(
        'public.allocate_onchain_withdrawal_nonce(uuid,text,text,text,bigint)'::regprocedure
    );
    IF position('gas_funding_operations' in v_definition) = 0
       OR position('hot_wallet_nonces' in v_definition) = 0 THEN
        RAISE EXCEPTION 'Withdrawal allocator is not fenced against unresolved gas funding';
    END IF;

    v_definition := pg_catalog.pg_get_functiondef(
        'public.record_evm_gas_funding_receipt(uuid,text,text,smallint,integer,numeric,numeric,bigint,text)'::regprocedure
    );
    IF position('p_confirmations' in v_definition) = 0
       OR position('v_required_confirmations' in v_definition) = 0 THEN
        RAISE EXCEPTION 'Gas receipt RPC does not independently enforce the minimum confirmation depth';
    END IF;

    RAISE NOTICE 'PASS: EVM gas funding and withdrawals share a service-only, operation-bound, finality-fenced nonce stream';
END;
$preflight$;
