-- Prevent anonymous mutation of advertising records and limit authenticated
-- clients to the INSERT paths explicitly protected by existing RLS policies.
BEGIN;

REVOKE ALL PRIVILEGES ON TABLE public.ads FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.ads FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.ads TO authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.p2p_ads FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.p2p_ads FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.p2p_ads TO authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.advertisements FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.advertisements FROM authenticated;
GRANT SELECT ON TABLE public.advertisements TO authenticated;

COMMIT;
