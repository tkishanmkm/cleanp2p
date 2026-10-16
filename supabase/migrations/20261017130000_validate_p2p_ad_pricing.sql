-- Enforce basic P2P ad pricing invariants in the database so malformed
-- limits cannot be created by bypassing client-side form validation.
BEGIN;

ALTER TABLE public.p2p_ads
  ADD CONSTRAINT p2p_ads_price_positive
  CHECK (price > 0);

ALTER TABLE public.p2p_ads
  ADD CONSTRAINT p2p_ads_min_limit_positive
  CHECK (min_limit > 0);

ALTER TABLE public.p2p_ads
  ADD CONSTRAINT p2p_ads_limit_order_valid
  CHECK (max_limit >= min_limit);

COMMIT;
