DO $$
DECLARE
  fn_oid oid := 'public.initiate_trade_with_escrow(text,numeric,numeric,text,numeric,text,text,text,uuid)'::regprocedure;
  fn_def text;
  old_assignment text := 'v_ad_price := COALESCE(v_ad.price, v_ad.unit_price, 1.0);';
  new_assignment text := 'v_ad_price := COALESCE(v_ad.price, v_ad.unit_price);';
  old_guard text := 'IF v_ad_price <= 0 THEN
        v_ad_price := 1.0;
    END IF;';
  new_guard text := 'IF v_ad_price IS NULL OR v_ad_price <= 0 THEN
        RAISE EXCEPTION ''Advertisement price is missing or invalid.''
            USING ERRCODE = ''P0001'', DETAIL = ''INVALID_AD_PRICE'';
    END IF;';
BEGIN
  fn_def := pg_get_functiondef(fn_oid);
  IF strpos(fn_def, old_assignment) = 0 OR strpos(fn_def, old_guard) = 0 THEN
    RAISE EXCEPTION 'Expected source anchors missing; no changes applied.';
  END IF;
  fn_def := replace(fn_def, old_assignment, new_assignment);
  fn_def := replace(fn_def, old_guard, new_guard);
  IF strpos(fn_def, new_assignment) = 0 OR strpos(fn_def, new_guard) = 0 THEN
    RAISE EXCEPTION 'Replacement verification failed; no changes applied.';
  END IF;
  EXECUTE fn_def;
END $$;