-- Withdrawal requests and status transitions are financial operations.
-- Clients may view only their own requests via the existing RLS policies.
BEGIN;

REVOKE ALL PRIVILEGES ON TABLE public.withdrawals FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.withdrawals FROM authenticated;

GRANT SELECT ON TABLE public.withdrawals TO authenticated;

COMMIT;
