-- Read-only post-migration check for database-generated Wayones branding.
DO $preflight$
DECLARE
  v_signature text;
  v_oid oid;
  v_definition text;
  v_owner text;
  v_config text[];
  v_security_definer boolean;
  v_checked_count integer := 0;
  v_signatures text[] := ARRAY[
    'public.admin_freeze_user(uuid,text)',
    'public.admin_unfreeze_user(uuid,text)',
    'public.admin_set_emergency_mode(boolean,text)',
    'public.execute_bulk_ban_atomic(uuid,text,text)',
    'public.execute_bulk_restrict_atomic(uuid,text,text)',
    'public.execute_bulk_unban_atomic(uuid,text)',
    'public.execute_bulk_unrestrict_atomic(uuid,text)',
    'public.refund_trade_escrow_to_seller(uuid,uuid,text)',
    'public.trigger_provision_user_wallets()',
    'public.trigger_withdrawal_worker()'
  ];
BEGIN
  FOREACH v_signature IN ARRAY v_signatures LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'FAIL: expected deployed function % is missing', v_signature;
    END IF;

    SELECT p.prosecdef, p.proconfig, pg_catalog.pg_get_userbyid(p.proowner)
      INTO v_security_definer, v_config, v_owner
      FROM pg_catalog.pg_proc AS p
     WHERE p.oid = v_oid;

    IF v_owner <> 'postgres'
       OR v_security_definer IS DISTINCT FROM TRUE
       OR NOT ('search_path=""' = ANY(COALESCE(v_config, ARRAY[]::text[]))) THEN
      RAISE EXCEPTION 'FAIL: % security attributes changed unexpectedly', v_signature;
    END IF;

    v_definition := pg_catalog.pg_get_functiondef(v_oid);
    IF v_definition ILIKE '%Paxones Moderator%'
       OR v_definition ILIKE '%Paxones System%'
       OR v_definition ILIKE '%Paxones administrator%'
       OR v_definition ILIKE '%https://paxones.com%'
       OR v_definition ILIKE '%@paxones.com%'
       OR v_definition ILIKE '%@paxones.internal%' THEN
      RAISE EXCEPTION 'FAIL: legacy brand literal remains in %', v_signature;
    END IF;

    v_checked_count := v_checked_count + 1;
  END LOOP;

  IF pg_catalog.pg_get_functiondef('public.refund_trade_escrow_to_seller(uuid,uuid,text)'::regprocedure)
       NOT ILIKE '%Wayones Moderator%' THEN
    RAISE EXCEPTION 'FAIL: escrow-refund chat sender has not been renamed';
  END IF;

  IF pg_catalog.to_regclass('public.trade_system_events') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attrdef AS d
      JOIN pg_catalog.pg_attribute AS a
        ON a.attrelid = d.adrelid AND a.attnum = d.adnum
      WHERE d.adrelid = 'public.trade_system_events'::regclass
        AND a.attname = 'sender_username'
        AND pg_catalog.pg_get_expr(d.adbin, d.adrelid) = '''Wayones System''::text'
    ) THEN
      RAISE EXCEPTION 'FAIL: new durable trade-system events do not default to Wayones System';
    END IF;
  END IF;

  IF pg_catalog.pg_get_functiondef('public.trigger_provision_user_wallets()'::regprocedure)
       NOT ILIKE '%https://wayones.com/api/auth/provision-wallets%'
     OR pg_catalog.pg_get_functiondef('public.trigger_withdrawal_worker()'::regprocedure)
       NOT ILIKE '%https://wayones.com/api/workers/withdrawal-worker%' THEN
    RAISE EXCEPTION 'FAIL: asynchronous callback origins do not use the Wayones domain';
  END IF;

  RAISE NOTICE 'PASS: % database functions retain postgres ownership, SECURITY DEFINER and empty search_path with Wayones branding.', v_checked_count;
END;
$preflight$;
