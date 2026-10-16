-- P2P trade state is financial/escrow state. Browser clients must not
-- directly mutate it; transitions must use validated server-side handlers.
BEGIN;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.p2p_trades FROM anon, authenticated;

DROP POLICY IF EXISTS "Users can update their own trades" ON public.p2p_trades;

COMMIT;
