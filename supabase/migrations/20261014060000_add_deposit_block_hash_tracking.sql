-- Add nullable canonical block identifiers before implementing reorg reconciliation.
-- Existing rows remain NULL until independently verified against their chain.
ALTER TABLE public.deposits
  ADD COLUMN IF NOT EXISTS block_hash text;

ALTER TABLE public.onchain_deposits
  ADD COLUMN IF NOT EXISTS block_hash text;

COMMENT ON COLUMN public.deposits.block_hash IS
  'Canonical block hash observed by an independent chain verifier; NULL means not yet verified/backfilled.';

COMMENT ON COLUMN public.onchain_deposits.block_hash IS
  'Canonical block hash observed by an independent chain verifier; NULL means not yet verified/backfilled.';
