-- Step 11: permit explicit admin adjustment ledger event types and bind
-- the privileged adjustment RPC to the canonical active-admin identity helper.
-- Guarded by exact live function/constraint/grant preconditions.
BEGIN;

DO $step_11_preflight$
DECLARE
  v_signature REGPROCEDURE := pg_catalog.to_regprocedure(
    'public.admin_adjust_wallet_asset_balance(uuid,uuid,text,text,numeric,text,text)'
  );
  v_helper REGPROCEDURE := pg_catalog.to_regprocedure(
    'public.is_active_admin_identity(uuid)'
  );
  v_owner TEXT;
  v_secdef BOOLEAN;
  v_config TEXT[];
  v_acl ACLITEM[];
  v_definition TEXT;
  v_source TEXT;
  v_constraint TEXT;
  v_invalid_rows BIGINT;
BEGIN
  IF v_signature IS NULL OR v_helper IS NULL THEN
    RAISE EXCEPTION
      'Step 11 refused: canonical wallet adjustment RPC or active-admin identity helper is missing.';
  END IF;

  SELECT pg_catalog.pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig,p.proacl,p.prosrc
    INTO v_owner,v_secdef,v_config,v_acl,v_source
  FROM pg_catalog.pg_proc p
  WHERE p.oid=v_signature;

  IF v_owner IS DISTINCT FROM 'postgres'
     OR v_secdef IS DISTINCT FROM TRUE
     OR v_config IS DISTINCT FROM ARRAY['search_path=""']::TEXT[] THEN
    RAISE EXCEPTION
      'Step 11 refused: admin wallet adjustment RPC owner, SECURITY DEFINER mode or empty search_path differs from the reviewed contract.';
  END IF;

  IF pg_catalog.has_function_privilege('anon',v_signature,'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated',v_signature,'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role',v_signature,'EXECUTE') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION
      'Step 11 refused: admin wallet adjustment RPC execution grants differ from the service-role-only contract.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid=v_helper
      AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
      AND p.prosecdef IS TRUE
      AND p.proconfig @> ARRAY['search_path=""']::TEXT[]
  ) THEN
    RAISE EXCEPTION
      'Step 11 refused: is_active_admin_identity(uuid) is not postgres-owned SECURITY DEFINER with empty search_path.';
  END IF;

  IF pg_catalog.strpos(v_source,'SELECT EXISTS (')=0
     OR pg_catalog.strpos(v_source,'FROM auth.users u')=0
     OR pg_catalog.strpos(v_source,'FROM public.app_admins')=0
     OR pg_catalog.strpos(v_source,'IF NOT v_is_admin THEN')=0
     OR pg_catalog.strpos(v_source,'admin_add')=0
     OR pg_catalog.strpos(v_source,'admin_subtract')=0
     OR pg_catalog.strpos(v_source,'public.is_active_admin_identity(p_admin_id)')>0 THEN
    RAISE EXCEPTION
      'Step 11 refused: admin wallet adjustment function no longer matches the reviewed legacy identity/event-type contract.';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(c.oid)
    INTO v_constraint
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid='public.ledger_entries'::REGCLASS
    AND c.conname='ledger_entries_type_check'
    AND c.contype='c';

  IF v_constraint IS NULL
     OR pg_catalog.strpos(v_constraint,'''deposit''')=0
     OR pg_catalog.strpos(v_constraint,'''withdrawal''')=0
     OR pg_catalog.strpos(v_constraint,'''withdrawal_pending''')=0
     OR pg_catalog.strpos(v_constraint,'''transfer''')=0
     OR pg_catalog.strpos(v_constraint,'''fee''')=0
     OR pg_catalog.strpos(v_constraint,'''admin_add''')>0
     OR pg_catalog.strpos(v_constraint,'''admin_subtract''')>0 THEN
    RAISE EXCEPTION
      'Step 11 refused: ledger_entries_type_check no longer matches the five-value reviewed contract.';
  END IF;

  SELECT count(*) INTO v_invalid_rows
  FROM public.ledger_entries
  WHERE type IS NULL
     OR type NOT IN ('deposit','withdrawal','withdrawal_pending','transfer','fee');

  IF v_invalid_rows <> 0 THEN
    RAISE EXCEPTION
      'Step 11 refused: ledger_entries contains % pre-existing rows outside the current allowed transaction types.',
      v_invalid_rows;
  END IF;
END;
$step_11_preflight$;

DO $step_11_function_patch$
DECLARE
  v_signature REGPROCEDURE := pg_catalog.to_regprocedure(
    'public.admin_adjust_wallet_asset_balance(uuid,uuid,text,text,numeric,text,text)'
  );
  v_definition TEXT;
  v_owner_before TEXT;
  v_secdef_before BOOLEAN;
  v_config_before TEXT[];
  v_acl_before ACLITEM[];
  v_owner_after TEXT;
  v_secdef_after BOOLEAN;
  v_config_after TEXT[];
  v_acl_after ACLITEM[];
  v_start INTEGER;
  v_end INTEGER;
  v_fragment TEXT;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig,p.proacl,
         pg_catalog.pg_get_functiondef(p.oid)
    INTO v_owner_before,v_secdef_before,v_config_before,v_acl_before,v_definition
  FROM pg_catalog.pg_proc p
  WHERE p.oid=v_signature;

  v_start := pg_catalog.strpos(v_definition,'SELECT EXISTS (');
  v_end := pg_catalog.strpos(v_definition,'IF NOT v_is_admin THEN',v_start);

  IF v_start=0 OR v_end<=v_start
     OR pg_catalog.strpos(v_definition,'SELECT EXISTS (',v_start+1)>0 THEN
    RAISE EXCEPTION
      'Step 11 refused: admin adjustment identity-check fragment is missing or ambiguous.';
  END IF;

  v_fragment := pg_catalog.substr(v_definition,v_start,v_end-v_start);
  IF pg_catalog.strpos(v_fragment,'FROM auth.users u')=0
     OR pg_catalog.strpos(v_fragment,'FROM public.app_admins')=0
     OR pg_catalog.strpos(v_fragment,'p.is_admin')=0
     OR pg_catalog.strpos(v_fragment,'p.role')=0 THEN
    RAISE EXCEPTION
      'Step 11 refused: admin adjustment authorization query does not match the reviewed legacy identity checks.';
  END IF;

  v_definition :=
    pg_catalog.substr(v_definition,1,v_start-1)
    || 'v_is_admin := public.is_active_admin_identity(p_admin_id);'
    || E'\n\n  '
    || pg_catalog.substr(v_definition,v_end);

  IF pg_catalog.strpos(v_definition,'v_is_admin := public.is_active_admin_identity(p_admin_id);')=0
     OR pg_catalog.strpos(v_definition,'FROM auth.users u')>0
     OR pg_catalog.strpos(v_definition,'FROM public.app_admins')>0 THEN
    RAISE EXCEPTION
      'Step 11 failed pre-execution verification of the canonical active-admin helper patch.';
  END IF;

  EXECUTE v_definition;

  SELECT pg_catalog.pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig,p.proacl
    INTO v_owner_after,v_secdef_after,v_config_after,v_acl_after
  FROM pg_catalog.pg_proc p
  WHERE p.oid=v_signature;

  IF v_owner_after IS DISTINCT FROM v_owner_before
     OR v_secdef_after IS DISTINCT FROM v_secdef_before
     OR v_config_after IS DISTINCT FROM v_config_before
     OR v_acl_after IS DISTINCT FROM v_acl_before THEN
    RAISE EXCEPTION
      'Step 11 failed postcondition: wallet adjustment RPC owner, SECDEF, search_path or grants changed.';
  END IF;
END;
$step_11_function_patch$;

ALTER TABLE public.ledger_entries
  DROP CONSTRAINT ledger_entries_type_check;

ALTER TABLE public.ledger_entries
  ADD CONSTRAINT ledger_entries_type_check
  CHECK (
    type = ANY (
      ARRAY[
        'deposit',
        'withdrawal',
        'withdrawal_pending',
        'transfer',
        'fee',
        'admin_add',
        'admin_subtract'
      ]::TEXT[]
    )
  );

DO $step_11_postconditions$
DECLARE
  v_signature REGPROCEDURE := pg_catalog.to_regprocedure(
    'public.admin_adjust_wallet_asset_balance(uuid,uuid,text,text,numeric,text,text)'
  );
  v_constraint TEXT;
  v_source TEXT;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(c.oid)
    INTO v_constraint
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid='public.ledger_entries'::REGCLASS
    AND c.conname='ledger_entries_type_check';

  SELECT p.prosrc INTO v_source
  FROM pg_catalog.pg_proc p
  WHERE p.oid=v_signature;

  IF v_constraint IS NULL
     OR pg_catalog.strpos(v_constraint,'''admin_add''')=0
     OR pg_catalog.strpos(v_constraint,'''admin_subtract''')=0
     OR pg_catalog.strpos(v_source,'public.is_active_admin_identity(p_admin_id)')=0
     OR pg_catalog.strpos(v_source,'admin_add')=0
     OR pg_catalog.strpos(v_source,'admin_subtract')=0
     OR pg_catalog.has_function_privilege('anon',v_signature,'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated',v_signature,'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role',v_signature,'EXECUTE') THEN
    RAISE EXCEPTION
      'Step 11 failed postcondition: adjustment ledger types or active-admin authorization contract were not installed.';
  END IF;
END;
$step_11_postconditions$;

COMMIT;
