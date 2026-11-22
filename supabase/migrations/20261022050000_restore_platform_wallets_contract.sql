-- Restore the platform custody-address registry expected by the application.
-- This table stores public addresses and custody metadata only; never store private keys here.
-- Apply only after production migration reconciliation and isolated-database validation.

CREATE TABLE IF NOT EXISTS public.platform_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL CHECK (role IN ('hot_wallet', 'cold_storage', 'fee_collector', 'escrow_pool')),
  asset_code TEXT NOT NULL REFERENCES public.assets(code) ON DELETE RESTRICT,
  network_code TEXT NOT NULL,
  public_address TEXT NOT NULL,
  custody_provider TEXT NOT NULL DEFAULT 'internal',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'deprecated')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.platform_wallets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.platform_wallets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.platform_wallets TO authenticated;
GRANT ALL ON TABLE public.platform_wallets TO service_role;

DROP POLICY IF EXISTS "Admins can view platform wallets" ON public.platform_wallets;
DROP POLICY IF EXISTS platform_wallets_admin_read ON public.platform_wallets;

CREATE POLICY platform_wallets_admin_read
  ON public.platform_wallets
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin()));

CREATE INDEX IF NOT EXISTS idx_platform_wallets_asset_network_status
  ON public.platform_wallets (asset_code, network_code, status);
