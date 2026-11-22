BEGIN;

REVOKE ALL PRIVILEGES ON TABLE public.network_gas_fees FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.network_gas_fees TO service_role;

COMMIT;