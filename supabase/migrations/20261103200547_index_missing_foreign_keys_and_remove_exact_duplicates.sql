BEGIN;

-- Cover foreign keys highlighted by Supabase Performance Advisor.
CREATE INDEX IF NOT EXISTS idx_deposits_user_id
  ON public.deposits (user_id);

CREATE INDEX IF NOT EXISTS idx_platform_ledger_entries_related_user_id
  ON public.platform_ledger_entries (related_user_id);

CREATE INDEX IF NOT EXISTS idx_profiles_emergency_frozen_by
  ON public.profiles (emergency_frozen_by);

CREATE INDEX IF NOT EXISTS idx_sweep_queue_user_id
  ON public.sweep_queue (user_id);

CREATE INDEX IF NOT EXISTS idx_utxo_reservations_sweep_id
  ON public.utxo_reservations (sweep_id);

-- Remove duplicate non-constraint index.
DROP INDEX IF EXISTS public.idx_feedback_trade;
DROP INDEX IF EXISTS public.uq_transfers_sender_idempotency;

-- Remove duplicate UNIQUE constraints, retaining one uniqueness guarantee
-- for each column set. None of the removed constraints backs a foreign key.
ALTER TABLE public.admin_main_wallets
  DROP CONSTRAINT IF EXISTS uq_admin_main_wallets_currency;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS uq_profiles_wallet_index;

ALTER TABLE public.wallets
  DROP CONSTRAINT IF EXISTS wallets_address_key;

COMMIT;
