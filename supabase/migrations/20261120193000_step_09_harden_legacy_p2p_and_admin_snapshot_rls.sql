-- Step 09: remove obsolete direct browser mutation paths from legacy P2P
-- state tables and bind admin status snapshot reads to an active admin identity.
-- Apply only after a schema-matched isolated replay and source-call-site review.
BEGIN;

DO $step_09_preflight$
DECLARE
  v_identity_oid OID := pg_catalog.to_regprocedure('public.is_active_admin_identity(uuid)');
  v_identity_owner TEXT;
  v_identity_definer BOOLEAN;
  v_identity_config TEXT[];
  v_p2p_trade_update_policy INTEGER;
  v_p2p_trade_mutation_policies INTEGER;
  v_p2p_order_all_policy INTEGER;
  v_p2p_order_other_policies INTEGER;
  v_snapshot_policy INTEGER;
BEGIN
  IF pg_catalog.to_regclass('public.p2p_trades') IS NULL
     OR pg_catalog.to_regclass('public.p2p_orders') IS NULL
     OR pg_catalog.to_regclass('public.admin_user_status_snapshots') IS NULL THEN
    RAISE EXCEPTION
      'Step 09 refused: one or more reviewed legacy P2P/admin snapshot tables are missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid='public.p2p_trades'::regclass AND relrowsecurity IS TRUE
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid='public.p2p_orders'::regclass AND relrowsecurity IS TRUE
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid='public.admin_user_status_snapshots'::regclass AND relrowsecurity IS TRUE
  ) THEN
    RAISE EXCEPTION
      'Step 09 refused: RLS must remain enabled on all reviewed tables.';
  END IF;

  SELECT count(*)::INTEGER
    INTO v_p2p_trade_update_policy
  FROM pg_catalog.pg_policies
  WHERE schemaname='public'
    AND tablename='p2p_trades'
    AND policyname='Users can update their own trades'
    AND cmd='UPDATE'
    AND qual LIKE '%auth.uid%'
    AND qual LIKE '%buyer_id%'
    AND qual LIKE '%seller_id%';

  SELECT count(*)::INTEGER
    INTO v_p2p_trade_mutation_policies
  FROM pg_catalog.pg_policies
  WHERE schemaname='public'
    AND tablename='p2p_trades'
    AND cmd IN ('INSERT','UPDATE','DELETE','ALL');

  IF v_p2p_trade_update_policy <> 1 OR v_p2p_trade_mutation_policies <> 1 THEN
    RAISE EXCEPTION
      'Step 09 refused: p2p_trades mutation policy set differs from the reviewed participant UPDATE-only contract (known update policy %, mutation policies %).',
      v_p2p_trade_update_policy,
      v_p2p_trade_mutation_policies;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public'
      AND tablename='p2p_trades'
      AND policyname='Users can view their own trades'
      AND cmd='SELECT'
      AND qual LIKE '%auth.uid%'
      AND qual LIKE '%buyer_id%'
      AND qual LIKE '%seller_id%'
  ) THEN
    RAISE EXCEPTION
      'Step 09 refused: participant-scoped p2p_trades SELECT policy is missing or has drifted.';
  END IF;

  SELECT count(*)::INTEGER
    INTO v_p2p_order_all_policy
  FROM pg_catalog.pg_policies
  WHERE schemaname='public'
    AND tablename='p2p_orders'
    AND policyname='Users can manage their own p2p orders'
    AND cmd='ALL'
    AND qual LIKE '%auth.uid%'
    AND qual LIKE '%user_id%';

  SELECT count(*)::INTEGER
    INTO v_p2p_order_other_policies
  FROM pg_catalog.pg_policies
  WHERE schemaname='public'
    AND tablename='p2p_orders'
    AND policyname <> 'Users can manage their own p2p orders';

  IF v_p2p_order_all_policy <> 1 OR v_p2p_order_other_policies <> 0 THEN
    RAISE EXCEPTION
      'Step 09 refused: p2p_orders policy set differs from the reviewed owner-ALL legacy contract.';
  END IF;

  SELECT count(*)::INTEGER
    INTO v_snapshot_policy
  FROM pg_catalog.pg_policies
  WHERE schemaname='public'
    AND tablename='admin_user_status_snapshots'
    AND policyname='admin_user_status_snapshots_mutate_policy'
    AND cmd='ALL'
    AND qual LIKE '%profiles.is_admin%'
    AND qual LIKE '%profiles.role%';

  IF v_snapshot_policy <> 1
     OR (
       SELECT count(*) FROM pg_catalog.pg_policies
       WHERE schemaname='public'
         AND tablename='admin_user_status_snapshots'
     ) <> 1 THEN
    RAISE EXCEPTION
      'Step 09 refused: admin_user_status_snapshots policy set differs from the reviewed profile-flag policy.';
  END IF;

  IF v_identity_oid IS NULL THEN
    RAISE EXCEPTION
      'Step 09 refused: public.is_active_admin_identity(uuid) is missing.';
  END IF;

  IF pg_catalog.to_regprocedure('public.is_active_admin_for_status_snapshot_access()') IS NOT NULL THEN
    RAISE EXCEPTION
      'Step 09 refused: snapshot helper function name already exists; review it before replacement.';
  END IF;

  SELECT pg_catalog.pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig
    INTO v_identity_owner,v_identity_definer,v_identity_config
  FROM pg_catalog.pg_proc p
  WHERE p.oid=v_identity_oid;

  IF v_identity_owner IS DISTINCT FROM 'postgres'
     OR v_identity_definer IS DISTINCT FROM TRUE
     OR v_identity_config IS DISTINCT FROM ARRAY['search_path=""']::TEXT[] THEN
    RAISE EXCEPTION
      'Step 09 refused: active-admin identity helper does not match the reviewed postgres-owned SECURITY DEFINER / empty-search-path contract.';
  END IF;

  -- Preserve server-side writes; abort if service_role no longer has the
  -- explicit access expected by the currently used API/worker code.
  IF NOT has_table_privilege('service_role','public.p2p_trades','SELECT')
     OR NOT has_table_privilege('service_role','public.p2p_trades','UPDATE')
     OR NOT has_table_privilege('service_role','public.p2p_orders','SELECT')
     OR NOT has_table_privilege('service_role','public.p2p_orders','UPDATE')
     OR NOT has_table_privilege('service_role','public.admin_user_status_snapshots','SELECT')
     OR NOT has_table_privilege('service_role','public.admin_user_status_snapshots','INSERT')
     OR NOT has_table_privilege('service_role','public.admin_user_status_snapshots','UPDATE') THEN
    RAISE EXCEPTION
      'Step 09 refused: required service_role table privileges have drifted.';
  END IF;

  -- Keep current app read paths and the snapshot report permission model.
  IF NOT has_table_privilege('authenticated','public.p2p_trades','SELECT')
     OR NOT has_table_privilege('authenticated','public.p2p_orders','SELECT')
     OR NOT has_table_privilege('authenticated','public.admin_user_status_snapshots','SELECT') THEN
    RAISE EXCEPTION
      'Step 09 refused: authenticated SELECT privileges have drifted.';
  END IF;

  IF has_table_privilege('anon','public.admin_user_status_snapshots','SELECT') THEN
    RAISE EXCEPTION
      'Step 09 refused: anonymous access is unexpectedly granted on admin snapshots.';
  END IF;
END;
$step_09_preflight$;

-- Legacy mirror tables remain readable to authenticated participants but no
-- browser role may mutate their status, counterparties, payment amounts or
-- signed transaction hashes. Current application writers use service_role
-- after the canonical trade RPC has authorized the state transition.
DROP POLICY "Users can update their own trades" ON public.p2p_trades;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.p2p_trades
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.p2p_trades FROM anon;
GRANT SELECT ON TABLE public.p2p_trades TO authenticated;

-- The old order-book endpoint is retired. The active API only reads legacy
-- p2p_orders for a compatibility fallback and performs the PAID compare/set
-- through a server-side authenticated handler; no browser DML is required.
DROP POLICY "Users can manage their own p2p orders" ON public.p2p_orders;
CREATE POLICY "Users can view their own legacy p2p orders"
  ON public.p2p_orders
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.p2p_orders
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.p2p_orders FROM anon;
GRANT SELECT ON TABLE public.p2p_orders TO authenticated;

-- Use the already-reviewed active-admin decision function. Do not reimplement
-- role flags in RLS: the identity helper rejects banned, suspended, on-hold,
-- disabled, or otherwise inactive administrators.
CREATE OR REPLACE FUNCTION public.is_active_admin_for_status_snapshot_access()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT public.is_active_admin_identity(auth.uid());
$function$;

ALTER FUNCTION public.is_active_admin_for_status_snapshot_access() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_active_admin_for_status_snapshot_access()
  FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.is_active_admin_for_status_snapshot_access()
  TO authenticated, postgres;

DROP POLICY admin_user_status_snapshots_mutate_policy
  ON public.admin_user_status_snapshots;

CREATE POLICY admin_user_status_snapshots_active_admin_read
  ON public.admin_user_status_snapshots
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_active_admin_for_status_snapshot_access()));

CREATE POLICY admin_user_status_snapshots_service_role_all
  ON public.admin_user_status_snapshots
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.admin_user_status_snapshots
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.admin_user_status_snapshots FROM anon;
GRANT SELECT ON TABLE public.admin_user_status_snapshots TO authenticated;

-- Postconditions: participant reads and server writes survive, direct browser
-- mutation is gone, and admin snapshots call the active-admin helper.
DO $step_09_postconditions$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public' AND tablename='p2p_trades'
      AND cmd IN ('INSERT','UPDATE','DELETE','ALL')
  ) OR has_table_privilege('anon','public.p2p_trades','INSERT')
     OR has_table_privilege('anon','public.p2p_trades','UPDATE')
     OR has_table_privilege('anon','public.p2p_trades','DELETE')
     OR has_table_privilege('authenticated','public.p2p_trades','INSERT')
     OR has_table_privilege('authenticated','public.p2p_trades','UPDATE')
     OR has_table_privilege('authenticated','public.p2p_trades','DELETE')
     OR NOT has_table_privilege('authenticated','public.p2p_trades','SELECT')
     OR NOT has_table_privilege('service_role','public.p2p_trades','UPDATE') THEN
    RAISE EXCEPTION 'Step 09 postcondition failed: p2p_trades client DML was not fully removed or trusted access was not preserved.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public' AND tablename='p2p_orders'
      AND cmd IN ('INSERT','UPDATE','DELETE','ALL')
  ) OR has_table_privilege('anon','public.p2p_orders','INSERT')
     OR has_table_privilege('anon','public.p2p_orders','UPDATE')
     OR has_table_privilege('anon','public.p2p_orders','DELETE')
     OR has_table_privilege('authenticated','public.p2p_orders','INSERT')
     OR has_table_privilege('authenticated','public.p2p_orders','UPDATE')
     OR has_table_privilege('authenticated','public.p2p_orders','DELETE')
     OR NOT has_table_privilege('authenticated','public.p2p_orders','SELECT')
     OR NOT has_table_privilege('service_role','public.p2p_orders','UPDATE') THEN
    RAISE EXCEPTION 'Step 09 postcondition failed: p2p_orders client DML was not fully removed or trusted access was not preserved.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public' AND tablename='admin_user_status_snapshots'
      AND cmd IN ('INSERT','UPDATE','DELETE','ALL')
      AND 'authenticated' = ANY(roles)
  ) OR has_table_privilege('anon','public.admin_user_status_snapshots','SELECT')
     OR has_table_privilege('authenticated','public.admin_user_status_snapshots','INSERT')
     OR has_table_privilege('authenticated','public.admin_user_status_snapshots','UPDATE')
     OR has_table_privilege('authenticated','public.admin_user_status_snapshots','DELETE')
     OR NOT has_table_privilege('authenticated','public.admin_user_status_snapshots','SELECT')
     OR NOT has_table_privilege('service_role','public.admin_user_status_snapshots','INSERT')
     OR NOT has_table_privilege('service_role','public.admin_user_status_snapshots','UPDATE') THEN
    RAISE EXCEPTION 'Step 09 postcondition failed: admin snapshot access is not active-admin read / service-role write only.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid='public.is_active_admin_for_status_snapshot_access()'::regprocedure
      AND p.prosecdef IS TRUE
      AND p.proconfig @> ARRAY['search_path=""']::TEXT[]
      AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
      AND has_function_privilege('authenticated',p.oid,'EXECUTE')
      AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'Step 09 postcondition failed: active-admin snapshot predicate is not securely callable.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public' AND tablename='admin_user_status_snapshots'
      AND policyname='admin_user_status_snapshots_active_admin_read'
      AND cmd='SELECT' AND 'authenticated'=ANY(roles)
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='public' AND tablename='admin_user_status_snapshots'
      AND policyname='admin_user_status_snapshots_service_role_all'
      AND cmd='ALL' AND 'service_role'=ANY(roles)
  ) THEN
    RAISE EXCEPTION 'Step 09 postcondition failed: expected active-admin and service-role policies are missing.';
  END IF;
END;
$step_09_postconditions$;

COMMIT;
