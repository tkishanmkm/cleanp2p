-- Step 11: install the exact service-only RPC contract used by the
-- current admin-balance-adjustment.ts caller. This is a wrapper around the
-- repaired atomic ledger function, not a legacy direct balance mutation path.
-- The application feature flag remains OFF until isolated PostgreSQL tests pass.
BEGIN;

DO $step_11_atomic_adjustment_wrapper_preflight$
DECLARE
  v_inner REGPROCEDURE := pg_catalog.to_regprocedure(
    'public.admin_adjust_wallet_asset_balance(uuid,uuid,text,text,numeric,text,text)'
  );
  v_active_admin REGPROCEDURE := pg_catalog.to_regprocedure(
    'public.is_active_admin_identity(uuid)'
  );
  v_constraint TEXT;
  v_inner_source TEXT;
BEGIN
  IF v_inner IS NULL OR v_active_admin IS NULL THEN
    RAISE EXCEPTION
      'Step 11 refused: repaired legacy wallet adjustment function or active-admin identity helper is missing.';
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.admin_adjust_balance_atomic(uuid,uuid,text,text,numeric,text,uuid)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION
      'Step 11 refused: admin_adjust_balance_atomic already exists; review its signature, body and ACL before replacement.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    WHERE p.oid=v_inner
      AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
      AND p.prosecdef IS TRUE
      AND p.proconfig @> ARRAY['search_path=""']::TEXT[]
      AND NOT pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
      AND pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
  ) THEN
    RAISE EXCEPTION
      'Step 11 refused: inner wallet adjustment function is not postgres-owned, empty-path, SECURITY DEFINER and service-role-only.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    WHERE p.oid=v_active_admin
      AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
      AND p.prosecdef IS TRUE
      AND p.proconfig @> ARRAY['search_path=""']::TEXT[]
  ) THEN
    RAISE EXCEPTION
      'Step 11 refused: active-admin identity helper is not postgres-owned SECURITY DEFINER with an empty search_path.';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(c.oid)
    INTO v_constraint
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid='public.ledger_entries'::REGCLASS
    AND c.conname='ledger_entries_type_check'
    AND c.contype='c';

  IF v_constraint IS NULL
     OR pg_catalog.strpos(v_constraint,'''admin_add''')=0
     OR pg_catalog.strpos(v_constraint,'''admin_subtract''')=0 THEN
    RAISE EXCEPTION
      'Step 11 refused: ledger_entries_type_check does not yet accept admin_add/admin_subtract.';
  END IF;

  SELECT p.prosrc INTO v_inner_source
  FROM pg_catalog.pg_proc p
  WHERE p.oid=v_inner;

  IF pg_catalog.strpos(v_inner_source,'public.is_active_admin_identity(p_admin_id)')=0
     OR pg_catalog.strpos(v_inner_source,'admin_add')=0
     OR pg_catalog.strpos(v_inner_source,'admin_subtract')=0
     OR pg_catalog.strpos(v_inner_source,'admin_audit_logs')=0
     OR pg_catalog.strpos(v_inner_source,'idempotency_key')=0 THEN
    RAISE EXCEPTION
      'Step 11 refused: inner function is missing active-admin, event-type, audit or idempotency guarantees.';
  END IF;
END;
$step_11_atomic_adjustment_wrapper_preflight$;

CREATE FUNCTION public.admin_adjust_balance_atomic(
  p_admin_id UUID,
  p_target_user_id UUID,
  p_asset TEXT,
  p_action TEXT,
  p_amount NUMERIC,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_idempotency_key TEXT;
  v_result JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required for atomic admin wallet adjustment'
      USING ERRCODE = '42501';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A request ID is required for idempotent wallet adjustment'
      USING ERRCODE = '22023';
  END IF;

  v_idempotency_key := 'admin_balance_adjust:' || p_request_id::TEXT;

  v_result := public.admin_adjust_wallet_asset_balance(
    p_admin_id,
    p_target_user_id,
    p_asset,
    p_action,
    p_amount,
    p_reason,
    v_idempotency_key
  );

  IF COALESCE((v_result ->> 'success')::BOOLEAN, FALSE) IS NOT TRUE
     OR v_result ->> 'new_balance' IS NULL THEN
    RAISE EXCEPTION 'Atomic wallet adjustment did not return a confirmed balance result'
      USING ERRCODE = '40001';
  END IF;

  RETURN v_result || pg_catalog.jsonb_build_object(
    'success', TRUE,
    'audit_logged', TRUE,
    'request_id', p_request_id,
    'idempotency_key', v_idempotency_key
  );
END;
$function$;

ALTER FUNCTION public.admin_adjust_balance_atomic(
  UUID,UUID,TEXT,TEXT,NUMERIC,TEXT,UUID
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_adjust_balance_atomic(
  UUID,UUID,TEXT,TEXT,NUMERIC,TEXT,UUID
) FROM PUBLIC, anon, authenticated, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION public.admin_adjust_balance_atomic(
  UUID,UUID,TEXT,TEXT,NUMERIC,TEXT,UUID
) TO service_role, postgres;

DO $step_11_atomic_adjustment_wrapper_postconditions$
DECLARE
  v_oid REGPROCEDURE := pg_catalog.to_regprocedure(
    'public.admin_adjust_balance_atomic(uuid,uuid,text,text,numeric,text,uuid)'
  );
BEGIN
  IF v_oid IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p
       WHERE p.oid=v_oid
         AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
         AND p.prosecdef IS TRUE
         AND p.proconfig @> ARRAY['search_path=""']::TEXT[]
         AND NOT pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
         AND NOT pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
         AND pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
     ) THEN
    RAISE EXCEPTION
      'Step 11 failed postcondition: admin_adjust_balance_atomic is not installed as a postgres-owned, empty-path, service-only SECURITY DEFINER RPC.';
  END IF;
END;
$step_11_atomic_adjustment_wrapper_postconditions$;

NOTIFY pgrst, 'reload schema';

COMMIT;
