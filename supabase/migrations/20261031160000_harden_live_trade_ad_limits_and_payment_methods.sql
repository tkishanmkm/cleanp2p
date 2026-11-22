-- Paxones forward recovery: enforce stored advertisement limits and payment methods inside the escrow RPC.
-- This migration is deliberately fail-closed: it patches only the exact audited function
-- fragments. If production differs, it raises and rolls back rather than guessing.
BEGIN;

DO $migration$
DECLARE
  v_signature regprocedure := to_regprocedure(
    'public.initiate_trade_with_escrow(text,numeric,numeric,text,numeric,text,text,text,uuid)'
  );
  v_definition text;
  v_original text;
  v_marker text;
  v_declarations text := E'    v_existing_trade RECORD;';
  v_declarations_new text := E'    v_existing_trade RECORD;\n    v_ad_row_json JSONB;\n    v_min_fiat NUMERIC;\n    v_max_fiat NUMERIC;\n    v_payment_methods JSONB;\n    v_methods_text TEXT;\n    v_methods_json JSONB;\n    v_payment_method_allowed BOOLEAN := FALSE;';
  v_insert text := E'    IF v_ad_user_id = v_effective_caller THEN';
  v_account_marker text := E'    -- 3. Determine Trade Counterparties based on Normalized Ad Type';
  v_account_block text := E'    -- Enforce account eligibility inside the SECURITY DEFINER RPC, not only in API routes.\n    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_effective_caller AND COALESCE(p.is_banned, FALSE) = FALSE AND COALESCE(p.is_restricted, FALSE) = FALSE AND COALESCE(p.is_on_hold, FALSE) = FALSE AND COALESCE(p.is_suspended, FALSE) = FALSE AND COALESCE(p.is_minor_restricted, FALSE) = FALSE AND p.account_status IS NOT NULL AND LOWER(BTRIM(p.account_status)) = ''active'' AND p.status IS NOT NULL AND LOWER(BTRIM(p.status::TEXT)) = ''active'') THEN\n        RAISE EXCEPTION ''Caller account is not eligible to initiate trades.'' USING ERRCODE = ''42501'', DETAIL = ''AD_CALLER_RESTRICTED'';\n    END IF;\n    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_ad_user_id AND COALESCE(p.is_banned, FALSE) = FALSE AND COALESCE(p.is_restricted, FALSE) = FALSE AND COALESCE(p.is_on_hold, FALSE) = FALSE AND COALESCE(p.is_suspended, FALSE) = FALSE AND COALESCE(p.is_minor_restricted, FALSE) = FALSE AND p.account_status IS NOT NULL AND LOWER(BTRIM(p.account_status)) = ''active'' AND p.status IS NOT NULL AND LOWER(BTRIM(p.status::TEXT)) = ''active'') THEN\n        RAISE EXCEPTION ''Advertisement owner account is not eligible for trading.'' USING ERRCODE = ''42501'', DETAIL = ''AD_OWNER_RESTRICTED'';\n    END IF;\n\n    -- 3. Determine Trade Counterparties based on Normalized Ad Type';
  v_insert_new text := E'    -- Read optional listing controls from the authoritative stored advertisement row.\n    v_ad_row_json := to_jsonb(v_ad);\n    BEGIN\n        v_min_fiat := NULLIF(COALESCE(NULLIF(BTRIM(v_ad_row_json->>''min_limit''), ''''), NULLIF(BTRIM(v_ad_row_json->>''min_amount''), '''')), '''')::NUMERIC;\n        v_max_fiat := NULLIF(COALESCE(NULLIF(BTRIM(v_ad_row_json->>''max_limit''), ''''), NULLIF(BTRIM(v_ad_row_json->>''max_amount''), '''')), '''')::NUMERIC;\n    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN\n        RAISE EXCEPTION ''Advertisement fiat limits are invalid.'' USING ERRCODE = ''22023'';\n    END;\n    IF (v_min_fiat IS NOT NULL AND v_min_fiat < 0) OR (v_max_fiat IS NOT NULL AND v_max_fiat <= 0) OR (v_min_fiat IS NOT NULL AND v_max_fiat IS NOT NULL AND v_min_fiat > v_max_fiat) THEN\n        RAISE EXCEPTION ''Advertisement fiat limits are misconfigured.'' USING ERRCODE = ''22023'';\n    END IF;\n\n    IF v_ad_user_id = v_effective_caller THEN';
  v_price_old text := '        v_ad_price := COALESCE(v_ad.price, v_ad.unit_price);';
  v_price_alt text := '        v_ad_price := COALESCE(v_ad.price, v_ad.unit_price, 1.0);';
  v_price_new text := '        v_ad_price := COALESCE(NULLIF(BTRIM(to_jsonb(v_ad)->>''fixed_rate''), '''')::NUMERIC, NULLIF(BTRIM(to_jsonb(v_ad)->>''price''), '''')::NUMERIC, NULLIF(BTRIM(to_jsonb(v_ad)->>''unit_price''), '''')::NUMERIC, 0);';
  v_currency_p2p_old text := E'        v_ad_fiat_currency := UPPER(COALESCE(v_ad.fiat_symbol, v_ad.fiat_currency, ''USD''));';
  v_currency_p2p_new text := E'        v_ad_fiat_currency := UPPER(COALESCE(\n            NULLIF(BTRIM(v_ad.fiat_currency), ''''),\n            NULLIF(BTRIM(v_ad.fiat_symbol), ''''),\n            NULLIF(BTRIM(to_jsonb(v_ad)->>''fiat''), ''''),\n            NULLIF(BTRIM(to_jsonb(v_ad)->>''currency''), ''''),\n            ''USD''\n        ));';
  v_fiat_old text := '    v_fiat_amount := ROUND((v_crypto_amount * v_unit_price), 2);';
  v_fiat_new text := E'    v_fiat_amount := ROUND((v_crypto_amount * v_unit_price), 2);\n\n    IF (v_min_fiat IS NOT NULL AND v_fiat_amount < v_min_fiat) OR (v_max_fiat IS NOT NULL AND v_fiat_amount > v_max_fiat) THEN\n        RAISE EXCEPTION ''Trade amount is outside this advertisement''''s limits.'' USING ERRCODE = ''22023'', DETAIL = ''AD_FIAT_LIMIT'';\n    END IF;\n\n    -- Payment methods must come from the stored advertisement, never a client override.\n    v_payment_methods := COALESCE(NULLIF(v_ad_row_json->''payment_methods'', ''null''::JSONB), NULLIF(v_ad_row_json->''payment_method'', ''null''::JSONB));\n    IF jsonb_typeof(v_payment_methods) = ''array'' THEN\n        SELECT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_payment_methods) AS method(value) WHERE LOWER(BTRIM(method.value)) = LOWER(BTRIM(COALESCE(p_payment_method, '''')))) INTO v_payment_method_allowed;\n    ELSIF jsonb_typeof(v_payment_methods) = ''string'' THEN\n        v_methods_text := BTRIM(v_payment_methods #>> ''{}'');\n        IF LEFT(v_methods_text, 1) = ''['' THEN\n            BEGIN v_methods_json := v_methods_text::JSONB; EXCEPTION WHEN invalid_text_representation THEN v_methods_json := NULL; END;\n        END IF;\n        IF jsonb_typeof(v_methods_json) = ''array'' THEN\n            SELECT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_methods_json) AS method(value) WHERE LOWER(BTRIM(method.value)) = LOWER(BTRIM(COALESCE(p_payment_method, '''')))) INTO v_payment_method_allowed;\n        ELSE\n            v_payment_method_allowed := LOWER(v_methods_text) = LOWER(BTRIM(COALESCE(p_payment_method, '''')));\n        END IF;\n    END IF;\n    IF NOT COALESCE(v_payment_method_allowed, FALSE) THEN\n        RAISE EXCEPTION ''Payment method is not configured for this advertisement.'' USING ERRCODE = ''22023'', DETAIL = ''AD_PAYMENT_METHOD_INVALID'';\n    END IF;';
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'Required initiate_trade_with_escrow signature not found; no changes made.';
  END IF;

  SELECT pg_get_functiondef(v_signature) INTO v_definition;
  v_original := v_definition;

  IF position(v_declarations in v_definition) = 0 OR position(v_insert in v_definition) = 0
     OR position(v_account_marker in v_definition) = 0
     OR (position(v_price_old in v_definition) = 0 AND position(v_price_alt in v_definition) = 0)
     OR position(v_currency_p2p_old in v_definition) = 0
     OR position(v_fiat_old in v_definition) = 0 THEN
    RAISE EXCEPTION 'Audited function definition has drifted; no changes made.';
  END IF;

  v_definition := replace(v_definition, v_declarations, v_declarations_new);
  v_definition := replace(v_definition, v_insert, v_insert_new);
  v_definition := replace(v_definition, v_account_marker, v_account_block);
  v_definition := replace(v_definition, v_price_old, v_price_new);
  v_definition := replace(v_definition, v_price_alt, v_price_new);
  v_definition := replace(v_definition, v_currency_p2p_old, v_currency_p2p_new);
  v_definition := replace(v_definition, v_fiat_old, v_fiat_new);

  IF v_definition = v_original OR position('AD_FIAT_LIMIT' in v_definition) = 0
     OR position('AD_PAYMENT_METHOD_INVALID' in v_definition) = 0
     OR position('AD_CALLER_RESTRICTED' in v_definition) = 0
     OR position('AD_OWNER_RESTRICTED' in v_definition) = 0
     OR position(v_currency_p2p_old in v_definition) > 0
     OR position(v_price_old in v_definition) > 0
     OR position(v_price_alt in v_definition) > 0 THEN
    RAISE EXCEPTION 'Trade RPC hardening verification failed; no changes made.';
  END IF;

  EXECUTE v_definition;
END;
$migration$;

-- The dynamic CREATE OR REPLACE above preserves the function's previous setting.
-- Re-assert the hardened empty path after replacement so this later migration
-- cannot undo the earlier escrow-RPC search_path lockdown.
ALTER FUNCTION public.initiate_trade_with_escrow(
    text, numeric, numeric, text, numeric, text, text, text, uuid
) SET search_path = '';

COMMIT;
