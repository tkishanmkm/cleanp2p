-- Dispute resolution authorization regression checks.
-- READ-ONLY assertions: run in staging after a reviewed hardening migration.
-- The current production function is expected to fail these checks because it
-- accepts user-editable raw_user_meta_data.role='admin' and is executable by
-- authenticated clients. Do not run settlement operations from this script.

DO $$
DECLARE
  v_fn regprocedure := to_regprocedure('public.resolve_trade_dispute(uuid,text,uuid,uuid)');
  v_def text;
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'FAIL: resolve_trade_dispute(uuid,text,uuid,uuid) is missing';
  END IF;

  IF has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated clients can directly execute dispute resolution';
  END IF;

  IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon can directly execute dispute resolution';
  END IF;

  SELECT pg_get_functiondef(v_fn) INTO v_def;

  IF position('raw_user_meta_data' in lower(v_def)) > 0 THEN
    RAISE EXCEPTION 'FAIL: dispute resolution trusts user-editable auth metadata';
  END IF;

  IF position('public.is_admin()' in lower(v_def)) = 0 THEN
    RAISE EXCEPTION 'FAIL: dispute resolution must use the trusted admin helper';
  END IF;

  IF position('FOR UPDATE' in upper(v_def)) = 0 THEN
    RAISE EXCEPTION 'FAIL: dispute resolution must lock dispute/trade rows';
  END IF;

  IF position('public.release_trade_escrow' in lower(v_def)) = 0
     OR position('public.cancel_p2p_trade' in lower(v_def)) = 0 THEN
    RAISE EXCEPTION 'FAIL: both winner settlement paths must remain explicitly routed';
  END IF;

  RAISE NOTICE 'PASS: dispute-resolution authorization assertions';
END;
$$;
