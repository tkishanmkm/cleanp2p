-- Enforce canonical ad fiat limits and payment-method allowlist in escrow initiation.
-- The ad creation route treats min_amount/max_amount as fiat values when estimating
-- required SELL inventory (limit / unit price); enforce against computed fiat total.
BEGIN;

DO $migration$
DECLARE
  v_definition TEXT;
  v_payment_anchor TEXT := '    v_unit_price := v_ad_price;
    v_fiat_currency := v_ad_fiat_currency;';
  v_payment_replacement TEXT := '    v_unit_price := v_ad_price;
    v_fiat_currency := v_ad_fiat_currency;

    -- Fail closed when the ad has no usable payment-method allowlist.
    IF COALESCE(array_length(v_ad.payment_methods, 1), 0) = 0
       OR p_payment_method IS NULL
       OR BTRIM(p_payment_method) = ''
       OR NOT EXISTS (
          SELECT 1
          FROM unnest(v_ad.payment_methods) AS allowed_method
          WHERE LOWER(BTRIM(allowed_method)) = LOWER(BTRIM(p_payment_method))
       ) THEN
      RAISE EXCEPTION 'Payment method is not permitted by this advertisement.'
        USING ERRCODE = 'P0001', DETAIL = 'PAYMENT_METHOD_NOT_ALLOWED';
    END IF;';
  v_limits_anchor TEXT := '    v_fiat_amount := ROUND((v_crypto_amount * v_unit_price), 2);
    v_escrow_fee := ROUND(v_crypto_amount * 0.015, 8);';
  v_limits_replacement TEXT := '    v_fiat_amount := ROUND((v_crypto_amount * v_unit_price), 2);

    -- Validate advertisement fiat-denominated order limits at the authoritative RPC.
    IF v_ad.min_amount IS NOT NULL AND v_ad.min_amount <= 0 THEN
      RAISE EXCEPTION 'Advertisement minimum trade limit is invalid.'
        USING ERRCODE = ''P0001'', DETAIL = ''INVALID_AD_LIMITS'';
    END IF;
    IF v_ad.max_amount IS NOT NULL AND v_ad.max_amount <= 0 THEN
      RAISE EXCEPTION 'Advertisement maximum trade limit is invalid.'
        USING ERRCODE = ''P0001'', DETAIL = ''INVALID_AD_LIMITS'';
    END IF;
    IF v_ad.min_amount IS NOT NULL AND v_ad.max_amount IS NOT NULL
       AND v_ad.max_amount < v_ad.min_amount THEN
      RAISE EXCEPTION 'Advertisement trade limits are inconsistent.'
        USING ERRCODE = ''P0001'', DETAIL = ''INVALID_AD_LIMITS'';
    END IF;
    IF v_ad.min_amount IS NOT NULL AND v_fiat_amount < v_ad.min_amount THEN
      RAISE EXCEPTION 'Trade fiat value is below the advertisement minimum.'
        USING ERRCODE = ''P0001'', DETAIL = ''TRADE_BELOW_AD_MINIMUM'';
    END IF;
    IF v_ad.max_amount IS NOT NULL AND v_fiat_amount > v_ad.max_amount THEN
      RAISE EXCEPTION 'Trade fiat value exceeds the advertisement maximum.'
        USING ERRCODE = ''P0001'', DETAIL = ''TRADE_ABOVE_AD_MAXIMUM'';
    END IF;

    v_escrow_fee := ROUND(v_crypto_amount * 0.015, 8);';
BEGIN
  v_definition := pg_get_functiondef(
    'public.initiate_trade_with_escrow(text,numeric,numeric,text,numeric,text,text,text,uuid)'::regprocedure
  );

  IF position(v_payment_anchor IN v_definition) = 0
     OR position(v_payment_replacement IN v_definition) > 0 THEN
    RAISE EXCEPTION 'Payment-method insertion anchor is missing or already patched; refusing migration.';
  END IF;
  IF position(v_limits_anchor IN v_definition) = 0
     OR position(v_limits_replacement IN v_definition) > 0 THEN
    RAISE EXCEPTION 'Trade-limit insertion anchor is missing or already patched; refusing migration.';
  END IF;

  v_definition := replace(v_definition, v_payment_anchor, v_payment_replacement);
  v_definition := replace(v_definition, v_limits_anchor, v_limits_replacement);

  EXECUTE v_definition;
END
$migration$;

COMMIT;