-- Existing ads_min_limit_check permits a zero minimum. P2P offers must have
-- a strictly positive minimum trade amount to avoid zero-value trade creation.
BEGIN;

ALTER TABLE public.ads
  ADD CONSTRAINT ads_min_limit_positive
  CHECK (min_limit > 0);

COMMIT;
