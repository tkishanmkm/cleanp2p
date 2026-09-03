-- ============================================================================
-- Supabase Migration: 20260903000006_system_alerts_and_request_withdrawal_v2.sql
-- Description: System alerts table, resolution procedure, and withdrawal v2 RPC
-- ============================================================================

-- 1. Table for storing system alerts (Low gas, under-collateralization, worker errors, etc.)
CREATE TABLE IF NOT EXISTS public.system_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_alerts_active 
    ON public.system_alerts(created_at DESC) 
    WHERE is_resolved = FALSE;

CREATE INDEX IF NOT EXISTS idx_system_alerts_type 
    ON public.system_alerts(alert_type, severity);

-- Enable RLS
ALTER TABLE public.system_alerts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'system_alerts' AND policyname = 'Admins can view and manage system alerts'
    ) THEN
        CREATE POLICY "Admins can view and manage system alerts"
            ON public.system_alerts
            FOR ALL
            USING (
                auth.role() = 'authenticated' AND (
                    EXISTS (
                        SELECT 1 FROM auth.users u
                        WHERE u.id = auth.uid()
                        AND (u.raw_user_meta_data->>'role' = 'admin' OR u.raw_app_meta_data->>'role' = 'admin')
                    )
                )
            )
            WITH CHECK (
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
        SELECT 1 FROM pg_policies WHERE tablename = 'system_alerts' AND policyname = 'Service role full access to system_alerts'
    ) THEN
        CREATE POLICY "Service role full access to system_alerts"
            ON public.system_alerts
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

-- 2. Procedure to resolve / dismiss an active alert
CREATE OR REPLACE FUNCTION public.resolve_system_alert(
    p_alert_id UUID,
    p_admin_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.system_alerts
    SET is_resolved = TRUE,
        resolved_by = p_admin_id,
        resolved_at = NOW(),
        updated_at = NOW()
    WHERE id = p_alert_id;
END;
$$;

-- 3. Stored procedure: request_withdrawal_v2
CREATE OR REPLACE FUNCTION public.request_withdrawal_v2(
    p_user_id UUID,
    p_network TEXT,
    p_to_address TEXT,
    p_amount NUMERIC(36, 18),
    p_fee NUMERIC(36, 18),
    p_asset TEXT DEFAULT 'USDT'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN public.request_withdrawal(
        p_user_id := p_user_id,
        p_network := p_network,
        p_to_address := p_to_address,
        p_amount := p_amount,
        p_fee := p_fee,
        p_asset := COALESCE(p_asset, 'USDT')
    );
END;
$$;
