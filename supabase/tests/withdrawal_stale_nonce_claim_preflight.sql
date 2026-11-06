-- Read-only verification for stale withdrawal claim nonce-state fencing.
DO $check$
DECLARE
  v_claim regprocedure :=
    to_regprocedure('public.claim_pending_withdrawals(integer,text)');
  v_allocator regprocedure :=
    to_regprocedure('public.allocate_onchain_withdrawal_nonce(uuid,text,text,text,bigint)');
  v_claim_definition text;
  v_allocator_definition text;
BEGIN
  IF v_claim IS NULL OR v_allocator IS NULL THEN
    RAISE EXCEPTION 'FAIL: withdrawal claim or nonce allocator RPC is missing.';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_claim) INTO v_claim_definition;
  SELECT pg_catalog.pg_get_functiondef(v_allocator) INTO v_allocator_definition;

  IF pg_catalog.strpos(v_claim_definition, 'WITHDRAWAL_STALE_PROCESSING_NONCE_STATE_GATE') = 0
     OR pg_catalog.strpos(v_claim_definition, $expected$upper(coalesce(r.status, '')) <> 'RESERVED'$expected$) = 0
     OR pg_catalog.strpos(v_claim_definition, 'public.onchain_withdrawal_nonce_reservations') = 0 THEN
    RAISE EXCEPTION 'FAIL: stale PROCESSING claims are not restricted to unsigned RESERVED nonce state.';
  END IF;

  IF pg_catalog.strpos(v_allocator_definition, 'Nonce reservation is no longer unsigned') = 0
     OR pg_catalog.strpos(v_allocator_definition, 'Reserved nonce is already consumed on-chain; automatic re-signing is prohibited') = 0
     OR pg_catalog.strpos(v_allocator_definition, 'An earlier gas-funding nonce for this hot wallet is unresolved; reconcile it before withdrawal allocation') = 0 THEN
    RAISE EXCEPTION 'FAIL: shared nonce allocator retry protections are missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = v_claim
      AND prosecdef IS TRUE
      AND proconfig @> ARRAY['search_path=""']::text[]
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = v_allocator
      AND prosecdef IS TRUE
      AND proconfig @> ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'FAIL: claim/allocator must remain SECURITY DEFINER with empty search_path.';
  END IF;

  IF has_function_privilege('anon', v_claim, 'EXECUTE')
     OR has_function_privilege('authenticated', v_claim, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_claim, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: withdrawal queue claim RPC is not service-role only.';
  END IF;

  RAISE NOTICE 'PASS: stale PROCESSING claims cannot fresh-sign against signed, broadcast, recovery, or terminal nonce reservations.';
END;
$check$;
