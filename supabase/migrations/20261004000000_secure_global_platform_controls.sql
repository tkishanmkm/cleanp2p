-- Migration: 20261004000000_secure_global_platform_controls.sql
-- Description: Establishes secure canonical global platform controls in public.system_settings and hardens user_blocks permissions.

-- 1. Ensure system_settings table exists with proper schema
CREATE TABLE IF NOT EXISTS public.system_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS on system_settings
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any to avoid duplication
DROP POLICY IF EXISTS "system_settings_select_policy" ON public.system_settings;
DROP POLICY IF EXISTS "system_settings_admin_mutate_policy" ON public.system_settings;

-- All users (authenticated and anon) can read platform settings so frontend and middleware can adapt to maintenance/feature gates
CREATE POLICY "system_settings_select_policy" ON public.system_settings
    FOR SELECT USING (true);

-- Only admin role or service role can mutate settings
CREATE POLICY "system_settings_admin_mutate_policy" ON public.system_settings
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()::uuid
              AND (
                role = 'admin'
                OR is_admin = true
                OR is_admin_account = true
              )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()::uuid
              AND (
                role = 'admin'
                OR is_admin = true
                OR is_admin_account = true
              )
        )
    );

-- 2. Seed canonical 7 global controls with false default (boolean JSONB)
INSERT INTO public.system_settings (key, value, updated_at)
VALUES
    ('prevent_new_trades', 'false'::jsonb, NOW()),
    ('prevent_withdrawals', 'false'::jsonb, NOW()),
    ('prevent_transfers', 'false'::jsonb, NOW()),
    ('prevent_new_ads', 'false'::jsonb, NOW()),
    ('prevent_user_login', 'false'::jsonb, NOW()),
    ('prevent_new_signups', 'false'::jsonb, NOW()),
    ('maintenance_mode', 'false'::jsonb, NOW())
ON CONFLICT (key) DO NOTHING;

-- 3. Harden user_blocks permissions
-- Anon must NEVER be able to read or mutate user_blocks
REVOKE ALL ON TABLE public.user_blocks FROM anon;
GRANT SELECT, INSERT, DELETE ON TABLE public.user_blocks TO authenticated;
GRANT ALL ON TABLE public.user_blocks TO service_role;

-- Ensure RLS on user_blocks is enabled and strict
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_blocks_select_policy" ON public.user_blocks;
DROP POLICY IF EXISTS "user_blocks_insert_policy" ON public.user_blocks;
DROP POLICY IF EXISTS "user_blocks_delete_policy" ON public.user_blocks;

CREATE POLICY "user_blocks_select_policy" ON public.user_blocks
    FOR SELECT USING (
        auth.uid() IS NOT NULL AND (
            blocker_id::uuid = auth.uid()::uuid OR
            blocked_id::uuid = auth.uid()::uuid OR
            EXISTS (
                SELECT 1 FROM public.profiles
                WHERE id = auth.uid()::uuid
                  AND (
                    role = 'admin'
                    OR is_admin = true
                    OR is_admin_account = true
                  )
            )
        )
    );

CREATE POLICY "user_blocks_insert_policy" ON public.user_blocks
    FOR INSERT WITH CHECK (
        auth.uid() IS NOT NULL AND (
            blocker_id::uuid = auth.uid()::uuid OR
            EXISTS (
                SELECT 1 FROM public.profiles
                WHERE id = auth.uid()::uuid
                  AND (
                    role = 'admin'
                    OR is_admin = true
                    OR is_admin_account = true
                  )
            )
        )
    );

CREATE POLICY "user_blocks_delete_policy" ON public.user_blocks
    FOR DELETE USING (
        auth.uid() IS NOT NULL AND (
            blocker_id::uuid = auth.uid()::uuid OR
            EXISTS (
                SELECT 1 FROM public.profiles
                WHERE id = auth.uid()::uuid
                  AND (
                    role = 'admin'
                    OR is_admin = true
                    OR is_admin_account = true
                  )
            )
        )
    );
