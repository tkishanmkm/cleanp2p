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
    'public.resolve_trade_dispute(uuid,text,uuid,uuid)'::regprocedure
  );
  v_start := pg_catalog.strpos(v_definition, 'v_is_admin :=');
  IF v_start = 0 THEN
    RAISE EXCEPTION 'resolve_trade_dispute admin-check start was not found';
  END IF;

  v_after_start := pg_catalog.substr(v_definition, v_start);
  v_relative_end := pg_catalog.strpos(v_after_start, 'IF NOT v_is_admin THEN');
  IF v_relative_end = 0 THEN
    RAISE EXCEPTION 'resolve_trade_dispute admin-check end was not found';
  END IF;
  v_end := v_start + v_relative_end - 1;

  v_new_block := $replacement$
v_is_admin := public.is_active_admin_identity(v_effective_caller);

    $replacement$;

  v_definition :=
    pg_catalog.left(v_definition, v_start - 1)
    || v_new_block
    || pg_catalog.substr(v_definition, v_end);
  EXECUTE v_definition;
END;
$migration$;

ALTER FUNCTION public.resolve_trade_dispute(uuid,text,uuid,uuid)
  SET search_path = '';

REVOKE ALL PRIVILEGES
  ON FUNCTION public.resolve_trade_dispute(uuid,text,uuid,uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
  ON FUNCTION public.resolve_trade_dispute(uuid,text,uuid,uuid)
  TO service_role;

COMMIT;
