BEGIN;

-- Admin audit logs are read by the admin UI and written by server-side
-- service-role APIs/RPCs only. Browser roles receive SELECT only, gated by
-- the central active-admin helper.
DROP POLICY IF EXISTS "No public access" ON public.admin_audit_logs;
DROP POLICY IF EXISTS "Admins can view audit logs" ON public.admin_audit_logs;

CREATE POLICY "Admins can view audit logs"
  ON public.admin_audit_logs
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

REVOKE ALL PRIVILEGES ON TABLE public.admin_audit_logs
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.admin_audit_logs TO authenticated;

-- Keep the authenticated-user owner-scoped policy. The duplicate PUBLIC
-- policy had the same predicate and only added an unnecessary anon grant.
DROP POLICY IF EXISTS "Users can view their own KYC record"
  ON public.kyc_verifications;

-- Moderator administrators may mutate participation records; trade buyers
-- and sellers may read their own trade's moderator participation. Splitting
-- the admin mutation policy removes its overlapping SELECT grant.
DROP POLICY IF EXISTS trade_moderator_participations_mutate
  ON public.trade_moderator_participations;

CREATE POLICY trade_moderator_participations_admin_insert
  ON public.trade_moderator_participations
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY trade_moderator_participations_admin_update
  ON public.trade_moderator_participations
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY trade_moderator_participations_admin_delete
  ON public.trade_moderator_participations
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- The service-role policy is unnecessary for the client-facing PUBLIC role:
-- service_role already has its own ALL policy and bypasses RLS.
DROP POLICY IF EXISTS "Service role has full access to transfers"
  ON public.transfers;

-- RLS on the legacy user_balances table already has owner-scoped SELECT. The
-- other policy only returns true for service_role, which bypasses RLS; remove
-- the redundant PUBLIC ALL policy without affecting service-role operations.
DROP POLICY IF EXISTS user_balances_all_admin
  ON public.user_balances;

COMMIT;
