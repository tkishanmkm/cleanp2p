-- Stores the 20 admin-managed rotating deposit-address sets used by the dashboard.
-- This table is distinct from deposit_addresses, which stores per-user assigned addresses.

CREATE TABLE IF NOT EXISTS public.crypto_deposit_addresses (
  id TEXT PRIMARY KEY CHECK (id ~ '^(1[0-9]|20|[1-9])$'),
  set_name TEXT NOT NULL,
  addresses JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(addresses) = 'object'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.crypto_deposit_addresses ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.crypto_deposit_addresses FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.crypto_deposit_addresses TO authenticated;
GRANT ALL ON TABLE public.crypto_deposit_addresses TO service_role;

DROP POLICY IF EXISTS crypto_deposit_address_sets_admin_all
  ON public.crypto_deposit_addresses;

CREATE POLICY crypto_deposit_address_sets_admin_all
  ON public.crypto_deposit_addresses
  FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));
