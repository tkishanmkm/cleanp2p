-- Fail closed when either trade participant has a missing or invalid account status.
-- Replace only the two existing eligibility predicates in the canonical RPC.
DO $migration$
DECLARE
  v_def text;
  v_old text := $old$OR LOWER(COALESCE(p.account_status, 'active')) <> 'active'$old$;
  v_new text := $new$OR p.account_status IS NULL
            OR LOWER(BTRIM(p.account_status)) <> 'active'$new$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'initiate_trade_with_escrow'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_ad_id text, p_crypto_amount numeric, p_fiat_amount numeric, p_fiat_currency text, p_price numeric, p_payment_method text, p_trade_ref text, p_idempotency_key text, p_caller_id uuid';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'Canonical escrow function signature not found; no change applied.';
  END IF;

  IF position('p.account_status IS NULL' in v_def) > 0
     AND position('LOWER(BTRIM(p.account_status)) <> ''active''' in v_def) > 0 THEN
    RAISE NOTICE 'Fail-closed account status checks already exist.';
    RETURN;
  END IF;

  IF length(v_def) - length(replace(v_def, v_old, '')) <> 2 * length(v_old) THEN
    RAISE EXCEPTION 'Expected exactly two account-status predicates; found a different count. No change applied.';
  END IF;

  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END
$migration$;
