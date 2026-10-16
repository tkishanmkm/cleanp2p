-- Fail closed on restricted accounts during canonical P2P escrow initiation.
-- Preserves the current function body and inserts guards after its freeze checks.
DO $migration$
DECLARE
  v_def text;
  v_marker text := $marker$    IF v_counterparty_frozen THEN
        RAISE EXCEPTION 'USER_EMERGENCY_FROZEN: The counterparty account is currently under an emergency security freeze.'
            USING ERRCODE = 'P0001', DETAIL = 'USER_EMERGENCY_FROZEN';
    END IF;$marker$;
  v_insert text := $insert$    IF v_counterparty_frozen THEN
        RAISE EXCEPTION 'USER_EMERGENCY_FROZEN: The counterparty account is currently under an emergency security freeze.'
            USING ERRCODE = 'P0001', DETAIL = 'USER_EMERGENCY_FROZEN';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = v_effective_caller
          AND (COALESCE(p.is_banned, FALSE)
            OR COALESCE(p.is_restricted, FALSE)
            OR COALESCE(p.is_suspended, FALSE)
            OR COALESCE(p.is_minor_restricted, FALSE)
            OR LOWER(COALESCE(p.account_status, 'active')) <> 'active')
    ) THEN
        RAISE EXCEPTION 'ACCOUNT_NOT_ELIGIBLE: Your account is not eligible to initiate a trade.'
            USING ERRCODE = 'P0001', DETAIL = 'ACCOUNT_NOT_ELIGIBLE';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = v_ad_user_id
          AND (COALESCE(p.is_banned, FALSE)
            OR COALESCE(p.is_restricted, FALSE)
            OR COALESCE(p.is_suspended, FALSE)
            OR COALESCE(p.is_minor_restricted, FALSE)
            OR LOWER(COALESCE(p.account_status, 'active')) <> 'active')
    ) THEN
        RAISE EXCEPTION 'COUNTERPARTY_NOT_ELIGIBLE: The other trade participant is not eligible to trade.'
            USING ERRCODE = 'P0001', DETAIL = 'COUNTERPARTY_NOT_ELIGIBLE';
    END IF;$insert$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'initiate_trade_with_escrow'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_ad_id text, p_crypto_amount numeric, p_fiat_amount numeric, p_fiat_currency text, p_price numeric, p_payment_method text, p_trade_ref text, p_idempotency_key text, p_caller_id uuid';
  IF v_def IS NULL THEN RAISE EXCEPTION 'Canonical escrow function signature not found.'; END IF;
  v_def := replace(v_def, chr(13), '');
  IF position('ACCOUNT_NOT_ELIGIBLE' in v_def) > 0 AND position('COUNTERPARTY_NOT_ELIGIBLE' in v_def) > 0 THEN
    RAISE NOTICE 'Eligibility checks already exist.'; RETURN;
  END IF;
  IF position(v_marker in v_def) = 0 THEN RAISE EXCEPTION 'Freeze-check marker not found; no change applied.'; END IF;
  v_def := replace(v_def, v_marker, v_insert);
  EXECUTE v_def;
END
$migration$;
