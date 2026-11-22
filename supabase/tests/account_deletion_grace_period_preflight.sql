-- Read-only preflight for account-deletion grace period and cleanup scheduler.
DO $preflight$
DECLARE
  v_signature text;
  v_oid oid;
  v_owner text;
  v_config text[];
  v_definer boolean;
  v_definition text;
  v_column_count integer;
BEGIN
  SELECT count(*) INTO v_column_count
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='profiles'
    AND column_name IN ('deletion_requested_at','deletion_scheduled_for','deletion_completed_at');
  IF v_column_count <> 3 THEN
    RAISE EXCEPTION 'FAIL: profile deletion timestamps are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indexrelid=to_regclass('public.profiles_due_deletion_idx')
      AND i.indisvalid AND NOT i.indisprimary
      AND pg_get_expr(i.indpred,i.indrelid) LIKE '%DELETION_PENDING%'
  ) THEN
    RAISE EXCEPTION 'FAIL: due-deletion partial index is missing/invalid';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.account_deletion_cleanup_queue'::regclass) THEN
    RAISE EXCEPTION 'FAIL: cleanup queue RLS is not enabled';
  END IF;
  IF pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.account_deletion_cleanup_queue'::regclass)) <> 'postgres' THEN
    RAISE EXCEPTION 'FAIL: cleanup queue owner is not postgres';
  END IF;
  IF NOT has_table_privilege('service_role','public.account_deletion_cleanup_queue','SELECT')
     OR NOT has_table_privilege('service_role','public.account_deletion_cleanup_queue','INSERT')
     OR NOT has_table_privilege('service_role','public.account_deletion_cleanup_queue','UPDATE')
     OR NOT has_table_privilege('service_role','public.account_deletion_cleanup_queue','DELETE')
     OR has_table_privilege('anon','public.account_deletion_cleanup_queue','SELECT')
     OR has_table_privilege('authenticated','public.account_deletion_cleanup_queue','SELECT') THEN
    RAISE EXCEPTION 'FAIL: cleanup queue ACLs are not server-only';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.deactivate_ads_for_account_deletion()',
    'public.finalize_due_account_deletions()',
    'public.invoke_account_deletion_media_cleanup()',
    'public.schedule_account_deletion_media_cleanup()'
  ] LOOP
    v_oid := to_regprocedure(v_signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'FAIL: required deletion function % is missing',v_signature;
    END IF;
    SELECT p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner)
      INTO v_definer,v_config,v_owner
      FROM pg_proc p WHERE p.oid=v_oid;
    IF v_definer IS DISTINCT FROM TRUE OR v_owner <> 'postgres'
       OR NOT ('search_path=""'=ANY(COALESCE(v_config,ARRAY[]::text[]))) THEN
      RAISE EXCEPTION 'FAIL: % must be postgres-owned SECURITY DEFINER with empty search_path',v_signature;
    END IF;
    IF has_function_privilege('anon',v_oid,'EXECUTE')
       OR has_function_privilege('authenticated',v_oid,'EXECUTE')
       OR has_function_privilege('service_role',v_oid,'EXECUTE')
       OR EXISTS (
         SELECT 1 FROM pg_proc p
         CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
         WHERE p.oid=v_oid AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
       ) THEN
      RAISE EXCEPTION 'FAIL: % is exposed beyond postgres',v_signature;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid='public.profiles'::regclass
      AND t.tgname='deactivate_ads_for_account_deletion'
      AND NOT t.tgisinternal
      AND pg_get_triggerdef(t.oid) ILIKE '%AFTER UPDATE OF account_status%'
  ) THEN
    RAISE EXCEPTION 'FAIL: account-deletion ad-deactivation trigger is missing';
  END IF;
  SELECT lower(pg_get_functiondef('public.deactivate_ads_for_account_deletion()'::regprocedure))
    INTO v_definition;
  IF strpos(v_definition,'public.ads')=0
     OR strpos(v_definition,'public.p2p_ads')=0
     OR strpos(v_definition,'public.advertisements')=0 THEN
    RAISE EXCEPTION 'FAIL: account-deletion trigger does not pause every ad store';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname='paxones-finalize-account-deletions'
      AND active IS TRUE
      AND schedule='47 3 * * *'
      AND username='postgres'
  ) THEN
    RAISE EXCEPTION 'FAIL: postgres-owned daily account-deletion finalizer cron job is missing';
  END IF;

  IF to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL
     OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE EXCEPTION 'FAIL: account-deletion media cleanup HTTP/Vault dependencies are missing';
  END IF;

  SELECT lower(pg_get_functiondef('public.finalize_due_account_deletions()'::regprocedure))
    INTO v_definition;
  IF strpos(v_definition,'paxones_app_url')=0
     OR strpos(v_definition,'paxones_cron_secret')=0
     OR strpos(v_definition,'request.jwt.claim.role')=0
     OR strpos(v_definition,'for update skip locked')=0
     OR strpos(v_definition,'pg_advisory_xact_lock')=0 THEN
    RAISE EXCEPTION 'FAIL: finalizer lacks cleanup configuration fail-closed guard, trusted claim, row lock or overlap lock';
  END IF;

  -- The live project currently lacks both Vault secrets, so do not allow a
  -- media-cleanup cron job to be scheduled yet.
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name='paxones_app_url')
     OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name='paxones_cron_secret') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='paxones-account-deletion-media-cleanup' AND active IS TRUE) THEN
      RAISE EXCEPTION 'FAIL: media-cleanup cron job is active before required Vault secrets exist';
    END IF;
  END IF;

  RAISE NOTICE 'PASS: profile schedule, server-only queue/functions, ad deactivation, postgres cron finalizer and media-cleanup fail-closed gate are present. Media cron scheduling remains gated on Vault/CRON_SECRET configuration.';
END;
$preflight$;
