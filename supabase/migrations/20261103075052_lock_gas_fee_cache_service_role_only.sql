BEGIN;

DROP POLICY IF EXISTS "Anyone can view network gas fees" ON public.network_gas_fees;

REVOKE ALL PRIVILEGES ON TABLE public.network_gas_fees FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.network_gas_fees TO service_role;

COMMIT;