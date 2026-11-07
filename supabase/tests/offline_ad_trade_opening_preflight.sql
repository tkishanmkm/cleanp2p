-- Read-only post-deployment contract for offline-advertiser trade-opening guard.
DO $preflight$
DECLARE
  v_attempts regclass := pg_catalog.to_regclass('public.ad_offline_open_attempts');
  v_record regprocedure := pg_catalog.to_regprocedure(
    'public.record_ad_offline_open_attempt(text,text)'
  );
  v_guard regprocedure := pg_catalog.to_regprocedure(
    'public.guard_trade_seller_online()'
  );
BEGIN
  IF v_attempts IS NULL OR v_record IS NULL OR v_guard IS NULL THEN
    RAISE EXCEPTION 'Offline advertiser attempt table or required RPC/trigger function is missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='ads'
      AND column_name IN ('offline_open_attempts','offline_open_last_at')
    GROUP BY table_name HAVING count(*)=2
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='p2p_ads'
      AND column_name IN ('offline_open_attempts','offline_open_last_at')
    GROUP BY table_name HAVING count(*)=2
  ) THEN
    RAISE EXCEPTION 'Canonical or legacy ad offline-attempt counter columns are missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid=v_attempts AND c.relrowsecurity IS TRUE
  ) THEN
    RAISE EXCEPTION 'Offline attempt evidence table must have row-level security enabled.';
  END IF;

  IF has_table_privilege('anon', v_attempts, 'SELECT')
     OR has_table_privilege('authenticated', v_attempts, 'SELECT')
     OR has_table_privilege('anon', v_attempts, 'INSERT')
     OR has_table_privilege('authenticated', v_attempts, 'INSERT')
     OR NOT has_table_privilege('service_role', v_attempts, 'SELECT')
     OR NOT has_table_privilege('service_role', v_attempts, 'INSERT') THEN
    RAISE EXCEPTION 'Offline attempt table privileges are not server-only.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid=v_record
      AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname='postgres')
      AND p.prosecdef IS TRUE
      AND p.proconfig @> ARRAY['search_path=""']::text[]
      AND has_function_privilege('authenticated', v_record, 'EXECUTE')
      AND has_function_privilege('service_role', v_record, 'EXECUTE')
      AND NOT has_function_privilege('anon', v_record, 'EXECUTE')
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid=v_guard
      AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname='postgres')
      AND p.prosecdef IS TRUE
      AND p.proconfig @> ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'Offline attempt RPC and seller guard must be postgres-owned SECURITY DEFINER functions with empty search_path; the RPC grants must be authenticated/service-role only.';
  END IF;

  IF pg_catalog.strpos(pg_catalog.pg_get_functiondef(v_record), 'auth.uid()') = 0
     OR pg_catalog.strpos(pg_catalog.pg_get_functiondef(v_guard), 'current_setting(''role'', true)') = 0 THEN
    RAISE EXCEPTION 'Offline attempt ownership must come from auth.uid(), and direct trade guard service-role handling must be explicit.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid='public.trades'::regclass
      AND t.tgname='guard_trade_seller_online'
      AND NOT t.tgisinternal
      AND t.tgenabled IN ('O','A')
  ) THEN
    RAISE EXCEPTION 'Trade insert seller-online guard trigger is not enabled.';
  END IF;

  IF pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(v_record),
       'GREATEST(p.last_seen, p.last_seen_at)'
     ) = 0
     OR pg_catalog.strpos(pg_catalog.pg_get_functiondef(v_record), 'v_owner_online := v_is_online IS TRUE') = 0
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p
       WHERE p.proname='guard_trade_seller_online'
         AND p.pronamespace='public'::regnamespace
         AND pg_catalog.strpos(pg_catalog.pg_get_functiondef(p.oid), 'GREATEST(p.last_seen, p.last_seen_at)') > 0
         AND pg_catalog.strpos(pg_catalog.pg_get_functiondef(p.oid), 'IF NOT COALESCE(v_is_online, false)') > 0
     ) THEN
    RAISE EXCEPTION 'Seller online checks must use the newest of last_seen and last_seen_at so a fresh heartbeat is not shadowed by a stale timestamp.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname='paxones-ad-offline-attempt-retention'
  ) THEN
    RAISE EXCEPTION 'Offline-attempt retention cron job is missing.';
  END IF;
END;
$preflight$;
