-- Remove user-editable Auth user_metadata as an administrator trust source.
-- Supabase raw_user_meta_data is user-editable and must never grant admin authority.
-- Preserve all existing profile/app_metadata/admin-registry and trade participant checks.
-- Also bind verify_admin_login to the caller's own Auth identity to prevent user-ID probing.
-- Local migration candidate only: do not apply until the full production migration
-- history has been reconciled and the chain is replayed on a schema-faithful database.

BEGIN;

DO $migration$
DECLARE
  v_definition TEXT;
  v_updated_definition TEXT;
  v_pattern CONSTANT TEXT :=
    'OR[[:space:]]+raw_user_meta_data[[:space:]]*->[>][[:space:]]*''role''[[:space:]]*=[[:space:]]*''admin''';
  v_matches INTEGER;
BEGIN
  -- mark_p2p_trade_paid: remove only the unsafe user-editable role fallback.
  v_definition := pg_get_functiondef(
    'public.mark_p2p_trade_paid(uuid,uuid,text)'::regprocedure
  );
  v_matches := regexp_count(v_definition, v_pattern, 1, 'i');
  IF v_matches <> 1 THEN
    RAISE EXCEPTION
      'mark_p2p_trade_paid expected exactly one raw_user_meta_data admin fallback; found %',
      v_matches;
  END IF;
  v_updated_definition := regexp_replace(
    v_definition, v_pattern, '', 1, 1, 'i'
  );
  IF v_updated_definition = v_definition
     OR regexp_count(v_updated_definition, v_pattern, 1, 'i') <> 0 THEN
    RAISE EXCEPTION
      'mark_p2p_trade_paid unsafe admin fallback was not removed cleanly';
  END IF;
  EXECUTE v_updated_definition;

  -- raise_trade_dispute: apply the same narrow removal, preserving trusted admins
  -- and buyer/seller participant authorization.
  v_definition := pg_get_functiondef(
    'public.raise_trade_dispute(uuid,uuid,text)'::regprocedure
  );
  v_matches := regexp_count(v_definition, v_pattern, 1, 'i');
  IF v_matches <> 1 THEN
    RAISE EXCEPTION
      'raise_trade_dispute expected exactly one raw_user_meta_data admin fallback; found %',
      v_matches;
  END IF;
  v_updated_definition := regexp_replace(
    v_definition, v_pattern, '', 1, 1, 'i'
  );
  IF v_updated_definition = v_definition
     OR regexp_count(v_updated_definition, v_pattern, 1, 'i') <> 0 THEN
    RAISE EXCEPTION
      'raise_trade_dispute unsafe admin fallback was not removed cleanly';
  END IF;
  EXECUTE v_updated_definition;

  -- A signed-in user may only ask whether their own account is an administrator.
  -- The trusted server role may still validate a supplied user ID for server workflows.
  v_definition := pg_get_functiondef(
    'public.verify_admin_login(uuid,uuid)'::regprocedure
  );
  IF regexp_count(v_definition, 'IF[[:space:]]+v_uid[[:space:]]+IS[[:space:]]+NULL[[:space:]]+THEN', 1, 'i') <> 1 THEN
    RAISE EXCEPTION
      'verify_admin_login definition drifted; identity binding insertion point not unique';
  END IF;

  v_updated_definition := regexp_replace(
    v_definition,
    'IF[[:space:]]+v_uid[[:space:]]+IS[[:space:]]+NULL[[:space:]]+THEN',
    $replacement$IF COALESCE(auth.role(), '') <> 'service_role'
       AND (auth.uid() IS NULL OR v_uid IS DISTINCT FROM auth.uid()) THEN
        RETURN QUERY SELECT FALSE, NULL::TEXT, FALSE,
          'User ID must match the authenticated account.'::TEXT;
        RETURN;
    END IF;

    IF v_uid IS NULL THEN$replacement$,
    1, 1, 'i'
  );

  IF v_updated_definition = v_definition THEN
    RAISE EXCEPTION 'verify_admin_login caller identity guard was not inserted';
  END IF;
  EXECUTE v_updated_definition;
END;
$migration$;

-- Fail the migration if any of the three affected functions still contains
-- the unsafe user-editable administrator role predicate.
DO $postflight$
BEGIN
  IF position(
       'raw_user_meta_data' IN
       pg_get_functiondef('public.mark_p2p_trade_paid(uuid,uuid,text)'::regprocedure)
     ) > 0
     AND regexp_count(
       pg_get_functiondef('public.mark_p2p_trade_paid(uuid,uuid,text)'::regprocedure),
       'raw_user_meta_data[[:space:]]*->[>][[:space:]]*''role''[[:space:]]*=[[:space:]]*''admin''',
       1, 'i'
     ) > 0 THEN
    RAISE EXCEPTION 'mark_p2p_trade_paid still trusts raw_user_meta_data';
  END IF;

  IF regexp_count(
       pg_get_functiondef('public.raise_trade_dispute(uuid,uuid,text)'::regprocedure),
       'raw_user_meta_data[[:space:]]*->[>][[:space:]]*''role''[[:space:]]*=[[:space:]]*''admin''',
       1, 'i'
     ) > 0 THEN
    RAISE EXCEPTION 'raise_trade_dispute still trusts raw_user_meta_data';
  END IF;

  IF position(
       'User ID must match the authenticated account.'
       IN pg_get_functiondef('public.verify_admin_login(uuid,uuid)'::regprocedure)
     ) = 0 THEN
    RAISE EXCEPTION 'verify_admin_login caller identity guard is missing';
  END IF;
END;
$postflight$;

COMMIT;
