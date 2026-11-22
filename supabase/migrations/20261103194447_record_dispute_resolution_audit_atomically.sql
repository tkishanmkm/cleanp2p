BEGIN;

DO $migration$
DECLARE
  v_definition text;
  v_marker integer;
  v_declaration integer;
  v_audit_block text;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(
    'public.resolve_trade_dispute(uuid,text,uuid,uuid)'::regprocedure
  );

  v_declaration := pg_catalog.strpos(v_definition, 'v_resolution TEXT;');
  IF v_declaration = 0 THEN
    RAISE EXCEPTION 'resolve_trade_dispute email declaration insertion point not found';
  END IF;

  v_definition :=
    pg_catalog.left(v_definition, v_declaration + length('v_resolution TEXT;') - 1)
    || E'\r\n    v_admin_email TEXT;'
    || pg_catalog.substr(v_definition, v_declaration + length('v_resolution TEXT;'));
  EXECUTE v_definition;

  v_definition := pg_catalog.pg_get_functiondef(
    'public.resolve_trade_dispute(uuid,text,uuid,uuid)'::regprocedure
  );

  v_marker := pg_catalog.strpos(v_definition, '-- 11. RETURN RESULT');
  IF v_marker = 0 THEN
    RAISE EXCEPTION 'resolve_trade_dispute final return insertion point not found';
  END IF;

  v_audit_block := $audit$
    SELECT NULLIF(pg_catalog.btrim(u.email), '')
      INTO v_admin_email
    FROM auth.users u
    WHERE u.id = v_effective_caller;

    INSERT INTO public.admin_audit_logs (
      admin_id,
      admin_email,
      action,
      target_id,
      target_user_id,
      details,
      created_at
    )
    VALUES (
      v_effective_caller,
      v_admin_email,
      'RESOLVE_TRADE_DISPUTE',
      v_dispute.trade_id::text,
      p_winner_id,
      pg_catalog.jsonb_build_object(
        'dispute_id', p_dispute_id,
        'trade_id', v_dispute.trade_id,
        'winner_id', p_winner_id,
        'winner_role', v_winner_role,
        'resolution', v_resolution
      ),
      pg_catalog.clock_timestamp()
    );

$audit$;

  v_definition :=
    pg_catalog.left(v_definition, v_marker - 1)
    || v_audit_block
    || E'\r\n    '
    || pg_catalog.substr(v_definition, v_marker);
  EXECUTE v_definition;
END;
$migration$;

ALTER FUNCTION public.resolve_trade_dispute(uuid,text,uuid,uuid)
  SET search_path = '';

COMMIT;
