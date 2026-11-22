-- Read-only preflight for the current canonical deposit replay/credit guards.
-- Run only after the reviewed 20261104130000 and 20261107210306 migrations have
-- been applied to the intended Supabase project. This file is not auto-executed.

DO $check$
DECLARE
  v_rpc REGPROCEDURE :=
    pg_catalog.to_regprocedure(
      'public.process_deposit_atomic(text,text,text,numeric,text,integer,bigint,text,text,integer,text)'
    );
  v_definition TEXT;
  v_replay_guard_pos INTEGER;
  v_terminal_guard_pos INTEGER;
  v_pending_branch_pos INTEGER;
  v_ledger_section_pos INTEGER;
  v_ledger_count_pos INTEGER;
  v_wallet_balance_guard_pos INTEGER;
BEGIN
  IF v_rpc IS NULL THEN
    RAISE EXCEPTION 'FAIL: canonical process_deposit_atomic signature is missing';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_rpc) INTO v_definition;

  v_replay_guard_pos := pg_catalog.strpos(
    v_definition,
    'Scanner replay returned an existing credited deposit without changing balances'
  );
  v_terminal_guard_pos := pg_catalog.strpos(
    v_definition,
    'Terminal ledger invariant guard:'
  );
  v_pending_branch_pos := pg_catalog.strpos(v_definition, '-- PENDING DEPOSIT');
  v_ledger_section_pos := pg_catalog.strpos(v_definition, '-- LEDGER IDEMPOTENCY');
  v_ledger_count_pos := pg_catalog.strpos(v_definition, 'IF v_ledger_count > 1 THEN');
  v_wallet_balance_guard_pos := pg_catalog.strpos(v_definition, 'WALLET_ASSET_BALANCE_INVALID');

  IF v_replay_guard_pos = 0
     OR v_terminal_guard_pos = 0
     OR v_pending_branch_pos = 0
     OR v_ledger_section_pos = 0
     OR v_ledger_count_pos = 0
     OR v_wallet_balance_guard_pos = 0
     OR v_replay_guard_pos >= v_pending_branch_pos
     OR v_terminal_guard_pos >= v_ledger_count_pos
     OR v_wallet_balance_guard_pos >= v_pending_branch_pos THEN
    RAISE EXCEPTION 'FAIL: replay, terminal-ledger, or invalid-wallet-balance guard is missing or positioned after the unsafe writes';
  END IF;

  IF pg_catalog.strpos(v_definition, '''status'', ''ALREADY_CREDITED''') = 0
     OR pg_catalog.strpos(v_definition, '''already_credited'', true') = 0
     OR pg_catalog.strpos(v_definition, '''credited'', false') = 0
     OR pg_catalog.regexp_count(v_definition, 'DEPOSIT_STATE_INCONSISTENT') < 2 THEN
    RAISE EXCEPTION 'FAIL: idempotent replay and no-credit failure responses are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_rpc
      AND p.prosecdef IS TRUE
      AND p.proconfig @> ARRAY['search_path=pg_catalog']::TEXT[]
  ) THEN
    RAISE EXCEPTION 'FAIL: canonical deposit RPC is not SECURITY DEFINER with search_path=pg_catalog';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) acl
    WHERE p.oid = v_rpc
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  )
     OR has_function_privilege('anon', v_rpc, 'EXECUTE')
     OR has_function_privilege('authenticated', v_rpc, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_rpc, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: canonical deposit RPC grants do not match the server-only contract';
  END IF;

  RAISE NOTICE 'PASS: pending replays cannot reopen terminal deposits; ledger inconsistencies and invalid wallet balances fail closed';
END;
$check$;
