BEGIN;

DO $migration$
DECLARE
  v_definition text;
  v_updated text;
  v_worker_guard text := $guard$
  IF p_worker_id IS NULL
     OR btrim(p_worker_id) = ''
     OR length(p_worker_id) > 128 THEN
    RAISE EXCEPTION 'A valid withdrawal worker ID is required'
      USING ERRCODE = '22023';
  END IF;

$guard$;
  v_pause_guard text := $pause$
  -- Lock all four pause controls in this transaction so an administrative
  -- switch update cannot race a new/expired-lease dispatch claim.
  SELECT value INTO v_setting
  FROM public.system_settings
  WHERE key = 'prevent_withdrawals'
  FOR SHARE;

  IF NOT FOUND OR v_setting IS NULL OR pg_catalog.jsonb_typeof(v_setting) NOT IN ('boolean', 'string') THEN
    RAISE EXCEPTION 'Withdrawal pause control is unavailable; dispatch rejected'
      USING ERRCODE = 'P0001';
  END IF;
  v_prevent_withdrawals := (v_setting #>> '{}')::boolean;

  SELECT value INTO v_setting
  FROM public.system_settings
  WHERE key = 'emergency_mode'
  FOR SHARE;

  IF NOT FOUND OR v_setting IS NULL OR pg_catalog.jsonb_typeof(v_setting) NOT IN ('boolean', 'string') THEN
    RAISE EXCEPTION 'Emergency control is unavailable; dispatch rejected'
      USING ERRCODE = 'P0001';
  END IF;
  v_emergency_mode := (v_setting #>> '{}')::boolean;

  SELECT withdrawals_enabled, global_kill_switch_active
    INTO v_platform_settings
  FROM public.platform_settings
  WHERE id = 1
  FOR SHARE;

  IF NOT FOUND
     OR v_platform_settings.withdrawals_enabled IS DISTINCT FROM TRUE
     OR v_platform_settings.global_kill_switch_active IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'Platform withdrawal dispatch pause is active or unavailable'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_prevent_withdrawals OR v_emergency_mode THEN
    RAISE EXCEPTION 'System withdrawal dispatch pause is active'
      USING ERRCODE = 'P0001';
  END IF;

$pause$;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(
    'public.claim_pending_withdrawals(integer,text)'::regprocedure
  );

  IF pg_catalog.strpos(v_definition, '  v_rows integer := 0;') = 0
     OR pg_catalog.strpos(v_definition, v_worker_guard) = 0
     OR pg_catalog.strpos(v_definition, '  WITH candidates AS (') = 0
     OR pg_catalog.strpos(v_definition, 'v_setting jsonb;') > 0 THEN
    RAISE EXCEPTION 'claim_pending_withdrawals definition differs from audited version';
  END IF;

  v_updated := pg_catalog.replace(
    v_definition,
    '  v_rows integer := 0;',
    '  v_rows integer := 0;' || E'\n' ||
    '  v_setting jsonb;' || E'\n' ||
    '  v_prevent_withdrawals boolean;' || E'\n' ||
    '  v_emergency_mode boolean;' || E'\n' ||
    '  v_platform_settings record;'
  );

  v_updated := pg_catalog.replace(
    v_updated,
    v_worker_guard || '  WITH candidates AS (',
    v_worker_guard || v_pause_guard || '  WITH candidates AS ('
  );

  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'No withdrawal dispatch pause guard was added';
  END IF;

  EXECUTE v_updated;
END
$migration$;

COMMIT;