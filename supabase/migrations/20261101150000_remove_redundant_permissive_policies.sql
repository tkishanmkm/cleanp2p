-- Reduce verified redundant permissive policies without broadening access.
-- Each removal below is guarded by the exact live policy contract observed on
-- 2026-11-01. If any policy drifts, the migration aborts instead of guessing.
-- Local candidate only: validate against an isolated copy before deployment.
BEGIN;

DO $migration$
DECLARE
  v_count INTEGER;
BEGIN
  -- 20261031120000_remediate_live_database_advisors already removed the
  -- narrower opener-only disputes policy. Retain only the current superset check.
  SELECT COUNT(*) INTO v_count
    FROM pg_policies
   WHERE schemaname='public' AND tablename='disputes'
     AND policyname='Allow participants and admins to view disputes'
     AND roles::text='{authenticated}' AND cmd='SELECT'
     AND qual LIKE '%opened_by_id%' AND qual LIKE '%opened_by%'
     AND qual LIKE '%trades.buyer_id%' AND qual LIKE '%trades.seller_id%';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Disputes superset policy contract drifted; aborting.';
  END IF;

  -- 20261031120000_remediate_live_database_advisors already removed the
  -- owner-only feedback SELECT policy; the public TRUE policy remains.
  SELECT COUNT(*) INTO v_count
    FROM pg_policies
   WHERE schemaname='public' AND tablename='feedback'
     AND policyname='Public feedback is viewable by everyone'
     AND roles::text='{public}' AND cmd='SELECT' AND qual='true';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Public feedback policy contract drifted; aborting.';
  END IF;

  -- A permissive FALSE policy cannot grant any row; the admin policy remains.
  SELECT COUNT(*) INTO v_count
    FROM pg_policies
   WHERE schemaname='public' AND tablename='system_settings'
     AND policyname='No public access'
     AND roles::text='{public}' AND cmd='ALL' AND qual='false';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'system_settings false policy contract drifted; aborting.';
  END IF;
  SELECT COUNT(*) INTO v_count
    FROM pg_policies
   WHERE schemaname='public' AND tablename='system_settings'
     AND policyname='system_settings_admin_mutate_policy'
     AND roles::text='{public}' AND cmd='ALL'
     AND qual LIKE '%profiles.id%'
     AND qual LIKE '%auth.uid()%';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'system_settings admin policy contract drifted; aborting.';
  END IF;

  -- For transfers, keep the authenticated-only owner SELECT policy and the
  -- initplan-optimized service-role policy. The public copy has no anonymous
  -- effect because auth.uid() is NULL for anon; the older service policy is
  -- semantically identical but re-evaluates auth.role() per row.
  SELECT COUNT(*) INTO v_count
    FROM pg_policies
   WHERE schemaname='public' AND tablename='transfers'
     AND policyname='Users can view their own transfers'
     AND roles::text='{public}' AND cmd='SELECT'
     AND qual LIKE '%sender_id%'
     AND qual LIKE '%recipient_id%'
     AND qual LIKE '%auth.uid()%'
     AND regexp_count(qual, 'auth[.]uid[[:space:]]*[(][[:space:]]*[)]', 1, 'i') = 2;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Public transfers owner policy contract drifted; aborting.';
  END IF;
  SELECT COUNT(*) INTO v_count
    FROM pg_policies
   WHERE schemaname='public' AND tablename='transfers'
     AND policyname='Users can view own transfers'
     AND roles::text='{authenticated}' AND cmd='SELECT'
     AND qual LIKE '%sender_id%'
     AND qual LIKE '%recipient_id%'
     AND qual LIKE '%auth.uid()%'
     AND regexp_count(qual, 'auth[.]uid[[:space:]]*[(][[:space:]]*[)]', 1, 'i') = 2;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Authenticated transfers owner policy contract drifted; aborting.';
  END IF;

  -- 20261031120000_remediate_live_database_advisors already removed the
  -- participant-only user_blocks policy and retained the owner/admin superset.
  SELECT COUNT(*) INTO v_count
    FROM pg_policies
   WHERE schemaname='public' AND tablename='user_blocks'
     AND policyname='user_blocks_select_policy'
     AND roles::text='{authenticated}' AND cmd='SELECT'
     AND qual LIKE '%profiles.id%'
     AND qual LIKE '%auth.uid()%'
     AND qual LIKE '%is_admin_account%';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'user_blocks owner-and-admin policy contract drifted; aborting.';
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM pg_policies
   WHERE schemaname='public' AND tablename='transfers'
     AND policyname='Enable all access for service role on transfers'
     AND roles::text='{public}' AND cmd='ALL'
     AND qual LIKE '%auth.role()%'
     AND qual LIKE '%service_role%';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Optimized transfers service policy contract drifted; aborting.';
  END IF;
  SELECT COUNT(*) INTO v_count
    FROM pg_policies
   WHERE schemaname='public' AND tablename='transfers'
     AND policyname='Service role has full access to transfers'
     AND roles::text='{public}' AND cmd='ALL'
     AND qual LIKE '%auth.role()%'
     AND qual LIKE '%service_role%';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Legacy transfers service policy contract drifted; aborting.';
  END IF;
END;
$migration$;

DROP POLICY "No public access" ON public.system_settings;
DROP POLICY "Users can view their own transfers" ON public.transfers;
DROP POLICY "Service role has full access to transfers" ON public.transfers;

COMMIT;
