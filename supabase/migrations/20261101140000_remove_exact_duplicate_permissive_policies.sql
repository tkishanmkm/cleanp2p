-- Remove only policy pairs proven identical in the 2026-11-01 production catalog.
-- These DROP operations do not change the effective predicates or role scope:
-- each retained policy has the same command, roles, USING, and WITH CHECK.
-- Local migration candidate. Reconcile migration history and validate first.
BEGIN;

DO $migration$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*)
    INTO v_count
    FROM pg_policies a
    JOIN pg_policies b
      ON b.schemaname = a.schemaname
     AND b.tablename = a.tablename
     AND b.cmd = a.cmd
     AND b.roles = a.roles
     AND b.qual IS NOT DISTINCT FROM a.qual
     AND b.with_check IS NOT DISTINCT FROM a.with_check
   WHERE a.schemaname = 'public'
     AND a.tablename = 'transfers'
     AND a.policyname = 'Users can view own transfers'
     AND b.policyname = 'Users can view their sent and received transfers';

  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'Expected the two production transfers SELECT policies to be exactly equivalent; found % exact matches. Refusing cleanup.',
      v_count;
  END IF;

  SELECT COUNT(*)
    INTO v_count
    FROM pg_policies a
    JOIN pg_policies b
      ON b.schemaname = a.schemaname
     AND b.tablename = a.tablename
     AND b.cmd = a.cmd
     AND b.roles = a.roles
     AND b.qual IS NOT DISTINCT FROM a.qual
     AND b.with_check IS NOT DISTINCT FROM a.with_check
   WHERE a.schemaname = 'public'
     AND a.tablename = 'wallet_assets'
     AND a.policyname = 'Allow service role full access'
     AND b.policyname = 'Service role full access wallet_assets';

  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'Expected the two production wallet_assets service-role policies to be exactly equivalent; found % exact matches. Refusing cleanup.',
      v_count;
  END IF;
END;
$migration$;

DROP POLICY "Users can view their sent and received transfers" ON public.transfers;
DROP POLICY "Service role full access wallet_assets" ON public.wallet_assets;

COMMIT;
