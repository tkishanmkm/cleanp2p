-- Deposits are confirmed by trusted deposit-processing code only.
-- Do not let browser roles create, edit, or delete deposit records.
BEGIN;

REVOKE ALL PRIVILEGES ON TABLE public.deposits FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.deposits FROM authenticated;

COMMIT;
