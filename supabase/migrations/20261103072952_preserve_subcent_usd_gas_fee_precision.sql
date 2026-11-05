BEGIN;

-- USD gas quotes must retain sub-cent precision. Rounding to 2 decimals made
-- low-cost networks (especially BSC) store a real small fee as 0.00, causing
-- the withdrawal fee resolver to reject an otherwise valid live quote.
ALTER TABLE public.network_gas_fees
  ALTER COLUMN estimated_fee_usd TYPE numeric(36,12)
  USING estimated_fee_usd::numeric(36,12);

COMMENT ON COLUMN public.network_gas_fees.estimated_fee_usd
  IS 'Unmultiplied network gas cost in USD, retained to 12 decimal places for accurate low-cost network fee conversion.';

COMMIT;