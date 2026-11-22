-- Persist confirmation-check scheduling so the first 30 old transactions cannot starve newer withdrawals.
-- Apply only after validating this forward migration against a schema-matched isolated database.
BEGIN;

ALTER TABLE public.onchain_withdrawals
  ADD COLUMN IF NOT EXISTS next_confirmation_check_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_onchain_withdrawals_confirmation_schedule
  ON public.onchain_withdrawals (next_confirmation_check_at ASC, created_at ASC, id ASC)
  WHERE status IN ('BROADCASTED', 'PROCESSING', 'AMBIGUOUS_BROADCAST')
    AND tx_hash IS NOT NULL;

COMMIT;
