-- Read-only security regression checks for P2P cancellation authorization.
-- Safe to run against staging or production: this script does not mutate data.
-- These checks validate the installed function definition and ACLs, not the full
-- refund flow. Behavioral tests still require seeded staging data.

DO $$
DECLARE
  v_def text;
  v_fn regprocedure;
BEGIN
  v_fn := to_regprocedure('public.cancel_p2p_trade(uuid,uuid,text)');
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'FAIL: public.cancel_p2p_trade(uuid,uuid,text) is missing';
  END IF;

  SELECT pg_get_functiondef(v_fn) INTO v_def;

  IF position('public.is_admin()' in v_def) = 0 THEN
    RAISE EXCEPTION 'FAIL: cancellation does not delegate admin authorization to public.is_admin()';
  END IF;

  IF position('raw_user_meta_data' in v_def) > 0 THEN
    RAISE EXCEPTION 'FAIL: cancellation function references user-editable raw_user_meta_data';
  END IF;

  IF position('FOR UPDATE' in upper(v_def)) = 0 THEN
    RAISE EXCEPTION 'FAIL: cancellation does not lock the trade row';
  END IF;

  IF position('in_escrow >= v_total_escrow' in v_def) = 0 THEN
    RAISE EXCEPTION 'FAIL: refund does not guard against insufficient escrow';
  END IF;

  IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon can execute cancellation RPC';
  END IF;

  RAISE NOTICE 'PASS: static cancellation authorization and ACL checks';
END;
$$;

-- Expected behavior tests still required in staging:
-- 1. Nonparticipant cannot cancel another user's trade.
-- 2. Signed-in user cannot pass another user's p_caller_id.
-- 3. Non-admin cannot cancel a paid or disputed trade.
-- 4. Repeating cancellation does not create a second refund ledger entry.
-- 5. A failed ledger insert rolls back the wallet and trade updates.
-- 6. Admin dispute resolution follows an explicitly approved refund policy.
