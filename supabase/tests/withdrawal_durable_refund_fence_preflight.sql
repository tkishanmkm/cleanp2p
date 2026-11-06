-- Read-only post-apply verification for withdrawal refund fencing.
DO $check$
DECLARE
  v_oid regprocedure :=
    to_regprocedure('public.process_failed_withdrawal(uuid,text,numeric,text,boolean)');
  v_definition text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'FAIL: canonical failed-withdrawal RPC is missing.';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_oid)
    INTO v_definition;

  IF pg_catalog.strpos(v_definition, 'v_mirror public.withdrawals%ROWTYPE;') = 0
     OR pg_catalog.strpos(v_definition, 'PAIRED_WITHDRAWAL_HASH_MISMATCH') = 0 THEN
    RAISE EXCEPTION 'FAIL: paired withdrawal identity/hash guard is not installed.';
  END IF;

  IF pg_catalog.strpos(v_definition, 'WITHDRAWAL_DURABLE_PAYLOAD_REFUND_GUARD') = 0
     OR pg_catalog.strpos(v_definition, 'public.onchain_withdrawal_broadcasts') = 0
     OR pg_catalog.strpos(v_definition, 'public.onchain_withdrawal_nonce_reservations') = 0
     OR pg_catalog.strpos(v_definition, 'r.status <> ''RELEASED''') = 0 THEN
    RAISE EXCEPTION 'FAIL: unhashed refund is not fenced by signed payload and unreleased nonce state.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = v_oid
      AND prosecdef IS TRUE
      AND proconfig @> ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'FAIL: failed-withdrawal settlement must remain SECURITY DEFINER with empty search_path.';
  END IF;

  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: failed-withdrawal settlement grants are not server-only.';
  END IF;

  RAISE NOTICE 'PASS: an unhashed withdrawal cannot be refunded while a durable signed payload or unreleased EVM nonce reservation exists.';
END;
$check$;
