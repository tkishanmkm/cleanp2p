-- Restrict transfer writes to the trusted RPC/service role.
-- RLS is enabled, but table privileges and permissive INSERT policies should
-- not permit clients to create or mutate financial transfer records directly.
BEGIN;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.transfers FROM anon, authenticated;

DROP POLICY IF EXISTS "Users can insert transfers as sender" ON public.transfers;

-- Keep authenticated read access governed by the existing own-transfer SELECT policies.
GRANT SELECT ON TABLE public.transfers TO authenticated;

COMMIT;
