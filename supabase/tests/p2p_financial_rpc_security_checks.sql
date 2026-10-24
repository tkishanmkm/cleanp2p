-- P2P cancellation/release RPC security regression checks.
-- READ-ONLY: run as a database owner in staging after the hardening migration.
-- These assertions intentionally fail on the currently audited production state.
-- Do not weaken them to make the current schema pass; fix the RPCs and validate
-- every application/worker caller first.

DO $$
DECLARE
  v_cancel_atomic regprocedure := to_regprocedure('public.cancel_p2p_trade_atomic(uuid,uuid,text)');
  v_cancel_release regprocedure := to_regprocedure('public.cancel_trade_and_release_escrow(uuid,text)');
  v_finalize_release regprocedure := to_regprocedure('public.finalize_p2p_release(uuid,uuid,numeric,text)');
  v_def text;
BEGIN
  IF v_cancel_atomic IS NULL OR v_cancel_release IS NULL OR v_finalize_release IS NULL THEN
    RAISE EXCEPTION 'FAIL: one or more expected P2P financial RPCs are missing';
  END IF;

  -- These SECURITY DEFINER financial functions must not be directly callable
  -- by browser-authenticated clients. If a verified server caller exists, it
  -- should use a service-role client and enforce user/role checks in the route.
  IF has_function_privilege('authenticated', v_cancel_atomic, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated can execute cancel_p2p_trade_atomic';
  END IF;
  IF has_function_privilege('authenticated', v_cancel_release, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated can execute cancel_trade_and_release_escrow';
  END IF;
  IF has_function_privilege('authenticated', v_finalize_release, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated can execute finalize_p2p_release';
  END IF;

  SELECT pg_get_functiondef(v_cancel_atomic) INTO v_def;
  IF position('auth.uid()' in v_def) = 0 OR position('p_user_id' in v_def) = 0 THEN
    RAISE EXCEPTION 'FAIL: cancel_p2p_trade_atomic must explicitly validate caller identity';
  END IF;
  IF position('FOR UPDATE' in upper(v_def)) = 0 THEN
    RAISE EXCEPTION 'FAIL: cancel_p2p_trade_atomic must lock the trade row';
  END IF;

  SELECT pg_get_functiondef(v_cancel_release) INTO v_def;
  IF position('FOR UPDATE' in upper(v_def)) = 0 THEN
    RAISE EXCEPTION 'FAIL: cancel_trade_and_release_escrow must lock the trade row';
  END IF;
  IF position('ledger_entries' in v_def) = 0 THEN
    RAISE EXCEPTION 'FAIL: cancel_trade_and_release_escrow must write an auditable ledger entry';
  END IF;

  SELECT pg_get_functiondef(v_finalize_release) INTO v_def;
  IF position('auth.uid()' in v_def) = 0 THEN
    RAISE EXCEPTION 'FAIL: finalize_p2p_release must validate caller identity';
  END IF;
  IF position('FOR UPDATE' in upper(v_def)) = 0 THEN
    RAISE EXCEPTION 'FAIL: finalize_p2p_release must lock the trade row';
  END IF;

  RAISE NOTICE 'PASS: P2P cancellation/release RPC security assertions';
END;
$$;
