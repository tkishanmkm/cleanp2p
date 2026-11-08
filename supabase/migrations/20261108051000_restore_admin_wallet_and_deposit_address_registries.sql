-- Restore the admin custody-address and rotating deposit-address registries.
-- Only public wallet addresses/metadata are stored; never store private keys here.
BEGIN;

CREATE OR REPLACE FUNCTION public.is_active_full_admin_for_current_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.is_active_full_admin_actor(auth.uid());
$function$;

ALTER FUNCTION public.is_active_full_admin_for_current_user() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_active_full_admin_for_current_user()
  FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.is_active_full_admin_for_current_user()
  TO authenticated, postgres;

CREATE TABLE IF NOT EXISTS public.platform_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL
    CHECK (role IN ('hot_wallet', 'cold_storage', 'fee_collector', 'escrow_pool')),
  asset_code text NOT NULL REFERENCES public.assets(code) ON DELETE RESTRICT,
  network_code text NOT NULL CHECK (length(network_code) BETWEEN 1 AND 64),
  public_address text NOT NULL CHECK (length(public_address) BETWEEN 1 AND 256),
  custody_provider text NOT NULL DEFAULT 'internal',
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'deprecated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_wallets OWNER TO postgres;
ALTER TABLE public.platform_wallets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_wallets FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT SELECT ON TABLE public.platform_wallets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.platform_wallets TO service_role;

DROP POLICY IF EXISTS "Admins can view platform wallets" ON public.platform_wallets;
DROP POLICY IF EXISTS platform_wallets_admin_read ON public.platform_wallets;
CREATE POLICY platform_wallets_admin_read
  ON public.platform_wallets
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_active_full_admin_for_current_user()));

CREATE INDEX IF NOT EXISTS platform_wallets_asset_network_status_idx
  ON public.platform_wallets (asset_code, network_code, status);

CREATE TABLE IF NOT EXISTS public.crypto_deposit_addresses (
  id text PRIMARY KEY
    CHECK (id ~ '^(1[0-9]|20|[1-9])$'),
  set_name text NOT NULL CHECK (length(set_name) BETWEEN 1 AND 120),
  addresses jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(addresses) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crypto_deposit_addresses OWNER TO postgres;
ALTER TABLE public.crypto_deposit_addresses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crypto_deposit_addresses FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.crypto_deposit_addresses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.crypto_deposit_addresses TO service_role;

DROP POLICY IF EXISTS crypto_deposit_address_sets_admin_all
  ON public.crypto_deposit_addresses;
DROP POLICY IF EXISTS crypto_deposit_addresses_admin_all
  ON public.crypto_deposit_addresses;
CREATE POLICY crypto_deposit_address_sets_admin_all
  ON public.crypto_deposit_addresses
  FOR ALL
  TO authenticated
  USING ((SELECT public.is_active_full_admin_for_current_user()))
  WITH CHECK ((SELECT public.is_active_full_admin_for_current_user()));

COMMIT;
