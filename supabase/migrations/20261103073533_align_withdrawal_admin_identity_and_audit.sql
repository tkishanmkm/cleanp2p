BEGIN;

DO $migration$
DECLARE
  v_definition text;
  v_updated text;
BEGIN
  -- Keep the SQL authorization sources aligned with the trusted server check:
  -- app_admins membership, protected profile flags, or Supabase app_metadata.
  v_definition := pg_catalog.pg_get_functiondef(
    'public.approve_withdrawal(uuid,uuid)'::regprocedure
  );
  IF pg_catalog.strpos(v_definition, 'p.is_admin = true)') = 0
     OR pg_catalog.strpos(v_definition, '  ) INTO v_is_admin;') = 0
     OR pg_catalog.strpos(v_definition, 'v_is_admin boolean := false;') = 0
     OR pg_catalog.strpos(v_definition, 'admin_approver@paxones.com') = 0
     OR pg_catalog.strpos(v_definition, '  SELECT * INTO v_legacy') = 0 THEN
    RAISE EXCEPTION 'approve_withdrawal definition differs from the expected audited version; migration stopped';
  END IF;

  v_updated := pg_catalog.replace(v_definition,
    '  v_is_admin boolean := false;',
    '  v_is_admin boolean := false;' || E'\n' || '  v_admin_email text;');
  v_updated := pg_catalog.replace(v_updated,
    'p.is_admin = true)',
    'p.is_admin = true OR p.is_admin_account = true)');
  v_updated := pg_catalog.replace(v_updated,
    '  ) INTO v_is_admin;',
    '    UNION' || E'\n' ||
    '    SELECT 1 FROM auth.users u WHERE u.id = p_admin_id AND u.raw_app_meta_data->>''role'' = ''admin''' || E'\n' ||
    '  ) INTO v_is_admin;');
  v_updated := pg_catalog.replace(v_updated,
    '  SELECT * INTO v_legacy',
    '  SELECT nullif(pg_catalog.btrim(u.email), '''') INTO v_admin_email FROM auth.users u WHERE u.id = p_admin_id;' || E'\n' ||
    '  SELECT * INTO v_legacy');
  v_updated := pg_catalog.replace(v_updated,
    '''admin_approver@paxones.com''',
    'v_admin_email');
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'approve_withdrawal was not changed';
  END IF;
  EXECUTE v_updated;

  v_definition := pg_catalog.pg_get_functiondef(
    'public.reject_withdrawal_pending_approval(uuid,uuid,text)'::regprocedure
  );
  IF pg_catalog.strpos(v_definition, 'p.is_admin = true)') = 0
     OR pg_catalog.strpos(v_definition, '  ) INTO v_admin;') = 0
     OR pg_catalog.strpos(v_definition, 'v_admin boolean := false;') = 0
     OR pg_catalog.strpos(v_definition, '''admin@paxones.com''') = 0
     OR pg_catalog.strpos(v_definition, '  SELECT * INTO v_legacy') = 0 THEN
    RAISE EXCEPTION 'reject_withdrawal_pending_approval definition differs from the expected audited version; migration stopped';
  END IF;

  v_updated := pg_catalog.replace(v_definition,
    '  v_admin boolean := false;',
    '  v_admin boolean := false;' || E'\n' || '  v_admin_email text;');
  v_updated := pg_catalog.replace(v_updated,
    'p.is_admin = true)',
    'p.is_admin = true OR p.is_admin_account = true)');
  v_updated := pg_catalog.replace(v_updated,
    '  ) INTO v_admin;',
    '    UNION' || E'\n' ||
    '    SELECT 1 FROM auth.users u WHERE u.id = p_admin_id AND u.raw_app_meta_data->>''role'' = ''admin''' || E'\n' ||
    '  ) INTO v_admin;');
  v_updated := pg_catalog.replace(v_updated,
    '  SELECT * INTO v_legacy',
    '  SELECT nullif(pg_catalog.btrim(u.email), '''') INTO v_admin_email FROM auth.users u WHERE u.id = p_admin_id;' || E'\n' ||
    '  SELECT * INTO v_legacy');
  v_updated := pg_catalog.replace(v_updated,
    '''admin@paxones.com''',
    'v_admin_email');
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'reject_withdrawal_pending_approval was not changed';
  END IF;
  EXECUTE v_updated;
END
$migration$;

COMMIT;