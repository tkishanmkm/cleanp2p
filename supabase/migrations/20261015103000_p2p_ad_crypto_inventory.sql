-- Phase 2: give canonical P2P ads an explicit crypto inventory quantity.
-- This migration is intentionally not applied to the live database by this workflow.
ALTER TABLE public.p2p_ads
  ADD COLUMN IF NOT EXISTS total_amount numeric(38, 18) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS available_amount numeric(38, 18) NOT NULL DEFAULT 0;

ALTER TABLE public.p2p_ads
  ADD CONSTRAINT p2p_ads_total_amount_nonnegative
    CHECK (total_amount >= 0) NOT VALID,
  ADD CONSTRAINT p2p_ads_available_amount_nonnegative
    CHECK (available_amount >= 0) NOT VALID;

ALTER TABLE public.p2p_ads
  VALIDATE CONSTRAINT p2p_ads_total_amount_nonnegative;

ALTER TABLE public.p2p_ads
  VALIDATE CONSTRAINT p2p_ads_available_amount_nonnegative;

COMMENT ON COLUMN public.p2p_ads.total_amount IS
  'Total crypto quantity initially offered by this advertisement; not a fiat trade limit.';
COMMENT ON COLUMN public.p2p_ads.available_amount IS
  'Crypto quantity currently available for new trades; must be maintained transactionally with escrow lifecycle.';
