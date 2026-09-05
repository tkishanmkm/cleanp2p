-- ============================================================================
-- Supabase Migration: 20260905000002_step4_security_and_audit.sql
-- Description: Step 4 Security Infrastructure:
--              1. security_alerts table
--              2. admin_audit_logs table
--              3. check_is_admin() stored procedures
-- ============================================================================

-- 1. Create security_alerts table
CREATE TABLE IF NOT EXISTS public.security_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'CRITICAL' CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_alerts_active 
    ON public.security_alerts(created_at DESC) 
    WHERE is_resolved = FALSE;

CREATE INDEX IF NOT EXISTS idx_security_alerts_type_severity 
    ON public.security_alerts(alert_type, severity);

-- Enable RLS
ALTER TABLE public.security_alerts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'security_alerts' AND policyname = 'Admins can view and manage security alerts'
    ) THEN
        CREATE POLICY "Admins can view and manage security alerts"
            ON public.security_alerts
            FOR ALL
            USING (
                auth.role() = 'authenticated' AND (
                    EXISTS (
                        SELECT 1 FROM auth.users u
                        WHERE u.id = auth.uid()
                        AND (u.raw_user_meta_data->>'role' = 'admin' OR u.raw_app_meta_data->>'role' = 'admin')
                    )
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'security_alerts' AND policyname = 'Service role full access to security_alerts'
    ) THEN
        CREATE POLICY "Service role full access to security_alerts"
            ON public.security_alerts
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

-- 2. Create admin_audit_logs table
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    details JSONB DEFAULT '{}'::jsonb,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at ON public.admin_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_action ON public.admin_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_admin_id ON public.admin_audit_logs(admin_id);

-- Enable RLS
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'admin_audit_logs' AND policyname = 'Admins can view audit logs'
    ) THEN
        CREATE POLICY "Admins can view audit logs"
            ON public.admin_audit_logs
            FOR SELECT
            USING (
                auth.role() = 'authenticated' AND (
                    EXISTS (
                        SELECT 1 FROM auth.users u
                        WHERE u.id = auth.uid()
                        AND (u.raw_user_meta_data->>'role' = 'admin' OR u.raw_app_meta_data->>'role' = 'admin')
                    )
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'admin_audit_logs' AND policyname = 'Service role full access to admin_audit_logs'
    ) THEN
        CREATE POLICY "Service role full access to admin_audit_logs"
            ON public.admin_audit_logs
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

-- 3. Stored Procedure: check_is_admin (supports both p_user_id and user_uuid)
CREATE OR REPLACE FUNCTION public.check_is_admin(
    p_user_id UUID DEFAULT NULL,
    user_uuid UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_uid UUID := COALESCE(p_user_id, user_uuid, auth.uid());
    v_is_admin BOOLEAN := FALSE;
BEGIN
    IF v_uid IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Check metadata role
    SELECT (
        COALESCE(raw_user_meta_data->>'role', '') = 'admin' OR 
        COALESCE(raw_app_meta_data->>'role', '') = 'admin' OR
        COALESCE(raw_user_meta_data->>'is_admin', 'false')::BOOLEAN OR
        COALESCE(raw_app_meta_data->>'is_admin', 'false')::BOOLEAN
    ) INTO v_is_admin
    FROM auth.users
    WHERE id = v_uid;

    IF v_is_admin IS TRUE THEN
        RETURN TRUE;
    END IF;

    -- Check profiles table if exists
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'profiles'
    ) THEN
        SELECT (COALESCE(role, '') = 'admin' OR COALESCE(is_admin, FALSE))
        INTO v_is_admin
        FROM public.profiles
        WHERE id = v_uid;

        IF v_is_admin IS TRUE THEN
            RETURN TRUE;
        END IF;
    END IF;

    RETURN FALSE;
END;
$$;
