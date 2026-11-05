-- Read-only preflight for the admin-authorization hardening migrations.
-- Run ONLY against a disposable, schema-matched staging database after migrations.
-- This script performs no DDL/DML and fails closed if unsafe function bodies or ACLs remain.
DO $check$
DECLARE
  v_oid oid;
  v_definition text;
  v_signature text;
  v_targets text[] := ARRAY[
    'public.mark_p2p_trade_paid(uuid,uuid,text)',
    'public.raise_trade_dispute(uuid,uuid,text)',
    'public.resolve_trade_dispute(uuid,text,uuid,uuid)',
    'public.expire_p2p_trade(uuid)',
    'public.cancel_expired_p2p_trades()'
  ];
BEGIN
  v_oid := to_regprocedure('public.verify_admin_login(uuid,uuid)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'FAIL: public.verify_admin_login(uuid,uuid) is missing';
  END IF;

  v_definition := lower(pg_get_functiondef(v_oid));
  IF position('auth.uid()' IN v_definition) = 0
     OR position('p_user_uuid <> v_caller_id' IN v_definition) = 0
     OR position('user_uuid <> v_caller_id' IN v_definition) = 0
     OR position('raw_user_meta_data' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'FAIL: verify_admin_login does not enforce caller identity safely';
  END IF;

  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon can execute verify_admin_login';
  END IF;

  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated lost required execute access to verify_admin_login';
  END IF;

  FOREACH v_signature IN ARRAY v_targets LOOP
    v_oid := to_regprocedure(v_signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'FAIL: required function % is missing', v_signature;
    END IF;

    v_definition := lower(pg_get_functiondef(v_oid));
    IF position('raw_user_meta_data' IN v_definition) > 0 THEN
      RAISE EXCEPTION 'FAIL: user-editable metadata remains in %', v_signature;
    END IF;
  END LOOP;

  RAISE NOTICE 'PASS: admin login identity guard, anon ACL, and trade RPC metadata checks';
END;
$check$;
