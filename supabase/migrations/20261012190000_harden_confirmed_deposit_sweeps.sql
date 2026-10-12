-- A deposit is sweep-eligible only when its stored confirmation count still
-- satisfies the canonical chain threshold. Also remove mutable schemas from the
-- SECURITY DEFINER sweep-claim function's search path.
BEGIN;

DO $migration$
DECLARE
    v_signature REGPROCEDURE := 'public.claim_next_deposit_sweep(text,integer)'::REGPROCEDURE;
    v_definition TEXT;
    v_updated TEXT;
BEGIN
    SELECT pg_get_functiondef(v_signature) INTO v_definition;

    v_updated := regexp_replace(
        v_definition,
        'WHERE d\.status = ''CONFIRMED''[[:space:]]+AND d\.is_swept = FALSE',
        'WHERE d.status = ''CONFIRMED'' AND COALESCE(d.confirmations, 0) >= COALESCE(d.required_confirmations, CASE UPPER(TRIM(d.network)) WHEN ''BTC'' THEN 3 WHEN ''LTC'' THEN 12 WHEN ''ETH'' THEN 12 WHEN ''ERC20'' THEN 12 WHEN ''BEP20'' THEN 15 WHEN ''TRC20'' THEN 19 ELSE 2147483647 END) AND d.is_swept = FALSE',
        'g'
    );

    IF v_updated = v_definition
       OR position('COALESCE(d.confirmations, 0) >= COALESCE(d.required_confirmations' IN v_updated) = 0 THEN
        RAISE EXCEPTION 'Could not safely harden claim_next_deposit_sweep eligibility; no changes applied';
    END IF;

    EXECUTE v_updated;
END
$migration$;

ALTER FUNCTION public.claim_next_deposit_sweep(text, integer) SET search_path = '';

COMMIT;
