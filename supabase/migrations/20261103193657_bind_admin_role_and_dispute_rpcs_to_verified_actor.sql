BEGIN;

DO $migration$
DECLARE
  v_definition text;
  v_start integer;
  v_end integer;
  v_relative_end integer;
  v_after_start text;
  v_new_block text;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(
    'public.admin_update_user_role(uuid,uuid,text)'::regprocedure
  );
  v_start := pg_catalog.strpos(v_definition, 'v_caller_id := auth.uid();');
  v_end := pg_catalog.strpos(v_definition, 'IF NOT v_is_authorized THEN');
  IF v_start = 0 OR v_end = 0 OR v_end <= v_start THEN
    RAISE EXCEPTION 'admin_update_user_role authorization boundaries were not found';
  END IF;

  v_new_block := $replacement$
v_caller_id := auth.uid();
    IF auth.role() = 'service_role' THEN
        v_caller_id := p_admin_id;
        v_is_authorized := public.is_active_admin_identity(p_admin_id);
    ELSE
        v_is_authorized := v_caller_id IS NOT NULL
            AND p_admin_id = v_caller_id
            AND public.is_active_admin_identity(v_caller_id);
    END IF;

    $replacement$;

  v_definition :=
    pg_catalog.left(v_definition, v_start - 1)
    || v_new_block
    || pg_catalog.substr(v_definition, v_end);
  EXECUTE v_definition;

  v_definition := pg_catalog.pg_get_functiondef(
    'public.raise_trade_dispute(uuid,uuid,text)'::regprocedure
  );
  v_start := pg_catalog.strpos(v_definition, 'v_is_admin :=');
  IF v_start = 0 THEN
    RAISE EXCEPTION 'raise_trade_dispute admin check start was not found';
  END IF;

  v_after_start := pg_catalog.substr(v_definition, v_start);
  v_relative_end := pg_catalog.strpos(v_after_start, 'IF NOT (v_is_buyer');
  IF v_relative_end = 0 THEN
    RAISE EXCEPTION 'raise_trade_dispute admin check end was not found';
  END IF;
  v_end := v_start + v_relative_end - 1;

  v_new_block := $replacement$
v_is_admin := public.is_active_admin_identity(v_caller_id);



    $replacement$;

  v_definition :=
    pg_catalog.left(v_definition, v_start - 1)
    || v_new_block
    || pg_catalog.substr(v_definition, v_end);
  EXECUTE v_definition;
END;
$migration$;

ALTER FUNCTION public.raise_trade_dispute(uuid,uuid,text)
  SET search_path = '';

REVOKE ALL PRIVILEGES
  ON FUNCTION public.resolve_trade_dispute(uuid,text,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.get_admin_security_status(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
