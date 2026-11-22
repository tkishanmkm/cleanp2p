BEGIN;

-- system_settings is a server-only control table. The current app reads and
-- writes it through the service-role client; no browser callsite needs direct
-- Data API access. Remove the permissive SELECT policy and client grants.
DROP POLICY IF EXISTS system_settings_select_policy ON public.system_settings;
DROP POLICY IF EXISTS "No public access" ON public.system_settings;
DROP POLICY IF EXISTS system_settings_admin_mutate_policy ON public.system_settings;

REVOKE ALL PRIVILEGES ON TABLE public.system_settings
  FROM PUBLIC, anon, authenticated;

-- Remove redundant policies only where the retained policy has the same or
-- broader predicate and continues to enforce the existing effective access.
DROP POLICY IF EXISTS "Admins can view audit logs" ON public.admin_audit_logs;
CREATE POLICY "Admins can view audit logs"
  ON public.admin_audit_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND (
          p.role::text = 'admin'
          OR p.is_admin = true
          OR p.is_admin_account = true
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.app_admins a
      WHERE a.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS admin_user_status_snapshots_select_policy
  ON public.admin_user_status_snapshots;

DROP POLICY IF EXISTS "Users can view their own deposit addresses"
  ON public.deposit_addresses;

DROP POLICY IF EXISTS "Users can view disputes related to their trades"
  ON public.disputes;

DROP POLICY IF EXISTS "Enable read for own feedback"
  ON public.feedback;

DROP POLICY IF EXISTS "Enable all access for service role on transfers"
  ON public.transfers;

DROP POLICY IF EXISTS "Users can view own transfers"
  ON public.transfers;

DROP POLICY IF EXISTS "Users can view their own transfers"
  ON public.transfers;

DROP POLICY IF EXISTS "Users can view own block relationships"
  ON public.user_blocks;

DROP POLICY IF EXISTS "Allow service role full access"
  ON public.wallet_assets;

COMMIT;
