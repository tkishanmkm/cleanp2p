-- Correct the terminal status constraint used by process_deposit_atomic.
-- Keep existing states valid and permit CREDITED for successful atomic crediting.
BEGIN;
ALTER TABLE public.onchain_deposits DROP CONSTRAINT IF EXISTS onchain_deposits_status_check;
ALTER TABLE public.onchain_deposits ADD CONSTRAINT onchain_deposits_status_check CHECK (status::text = ANY (ARRAY['PENDING'::text, 'CONFIRMED'::text, 'CREDITED'::text, 'FAILED'::text]));
COMMIT;
