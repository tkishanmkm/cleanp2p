-- Ledger entries are financial audit records: clients may read their own
-- history through RLS, but must never write or delete ledger rows directly.
BEGIN;

REVOKE ALL PRIVILEGES ON TABLE public.ledger_entries FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.ledger_entries FROM authenticated;

GRANT SELECT ON TABLE public.ledger_entries TO authenticated;

COMMIT;
