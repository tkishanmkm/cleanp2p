-- Read-only post-apply verification for withdrawal admin review hardening.
DO $check$
DECLARE
  v_approve regprocedure := to_regprocedure('public.approve_withdrawal(uuid,uuid)');
  v_reject regprocedure := to_regprocedure('public.reject_withdrawal_pending_approval(uuid,uuid,text)');
  v_approve_def text;
  v_reject_def text;
BEGIN
  IF v_approve IS NULL OR v_reject IS NULL THEN
    RAISE EXCEPTION 'FAIL: canonical approval/rejection RPC signature is missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = v_approve
      AND prosecdef IS TRUE
      AND proconfig @> ARRAY['search_path=""']::text[]
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = v_reject
      AND prosecdef IS TRUE
      AND proconfig @> ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'FAIL: withdrawal review RPCs must remain SECURITY DEFINER with empty search_path.';
  END IF;

  IF NOT has_function_privilege('service_role', v_approve, 'EXECUTE')
     OR has_function_privilege('anon', v_approve, 'EXECUTE')
     OR has_function_privilege('authenticated', v_approve, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_reject, 'EXECUTE')
     OR has_function_privilege('anon', v_reject, 'EXECUTE')
     OR has_function_privilege('authenticated', v_reject, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: withdrawal review RPC grants are not server-only.';
  END IF;

  SELECT pg_get_functiondef(v_approve) INTO v_approve_def;
  SELECT pg_get_functiondef(v_reject) INTO v_reject_def;

  IF position('public.is_active_admin_identity(p_admin_id)' IN v_approve_def) = 0
     OR position('WITHDRAWAL_ADMIN_PAIR_MISMATCH' IN v_approve_def) = 0
     OR position('ADMIN_APPROVED_WITHDRAWAL' IN v_approve_def) = 0 THEN
    RAISE EXCEPTION 'FAIL: approval active-admin, paired-record or audit-replay guards are missing.';
  END IF;

  IF position('public.is_active_admin_identity(p_admin_id)' IN v_reject_def) = 0
     OR position('WITHDRAWAL_ADMIN_PAIR_MISMATCH' IN v_reject_def) = 0
     OR position('ADMIN_REJECTED_WITHDRAWAL' IN v_reject_def) = 0
     OR position('Administrative rejection refund ledger record does not match' IN v_reject_def) = 0 THEN
    RAISE EXCEPTION 'FAIL: rejection active-admin, paired-record, refund-ledger or audit-replay guards are missing.';
  END IF;

  IF position('wreject_' IN v_reject_def) = 0
     OR position('withdrawal_admin_rejected' IN v_reject_def) = 0 THEN
    RAISE EXCEPTION 'FAIL: rejection refund ledger event/idempotency reference is missing.';
  END IF;

  RAISE NOTICE 'PASS: approval/rejection use active-admin identity, paired canonical/mirror validation, no-hash rejection, exact refund ledger verification, audit-backed replay and server-only grants.';
END;
$check$;
