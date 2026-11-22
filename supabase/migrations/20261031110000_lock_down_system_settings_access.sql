-- Expose only the three non-secret platform access flags needed by middleware.
-- All browser writes are removed; admin/server writes already use the service-role
-- client. The 2FA tables remain intentionally service-role-only and are untouched.
BEGIN;

DROP POLICY IF EXISTS "system_settings_select_policy" ON public.system_settings;
DROP POLICY IF EXISTS "system_settings_admin_mutate_policy" ON public.system_settings;
DROP POLICY IF EXISTS "No public access" ON public.system_settings;
DROP POLICY IF EXISTS "Public can read platform access flags" ON public.system_settings;

REVOKE ALL PRIVILEGES ON TABLE public.system_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT (key, value) ON TABLE public.system_settings TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.system_settings TO service_role;

CREATE POLICY "Public can read platform access flags"
    ON public.system_settings
    FOR SELECT
    TO anon, authenticated
    USING (key IN ('emergency_mode', 'maintenance_mode', 'prevent_user_login'));

COMMIT;
