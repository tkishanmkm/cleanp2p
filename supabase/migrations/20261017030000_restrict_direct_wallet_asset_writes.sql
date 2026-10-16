-- Wallet balances are authoritative financial state. Clients may read only
-- their own rows through RLS; all mutations must go through trusted server RPCs.
BEGIN;

REVOKE ALL PRIVILEGES ON TABLE public.wallet_assets FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.wallet_assets FROM authenticated;

GRANT SELECT ON TABLE public.wallet_assets TO authenticated;

COMMIT;
