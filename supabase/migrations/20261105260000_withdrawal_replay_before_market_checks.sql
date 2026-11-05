-- Allow an authenticated service to return a completed withdrawal receipt before
-- checking current gas/price feeds. The fingerprint matches request_withdrawal_idempotent.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_withdrawal_idempotency_replay(
    p_user_id UUID,
    p_network TEXT,
    p_to_address TEXT,
    p_amount NUMERIC,
    p_asset TEXT,
    p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_request JSONB;
    v_request_hash TEXT;
    v_existing public.financial_idempotency_keys%ROWTYPE;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Service role required for withdrawal replay lookup.'
            USING ERRCODE = '42501';
    END IF;

    IF p_user_id IS NULL
       OR p_network IS NULL OR pg_catalog.btrim(p_network) = ''
       OR p_to_address IS NULL OR pg_catalog.btrim(p_to_address) = ''
       OR p_amount IS NULL OR p_amount <= 0
       OR p_amount::TEXT IN ('NaN', 'Infinity', '-Infinity')
       OR p_asset IS NULL OR pg_catalog.btrim(p_asset) = ''
       OR p_idempotency_key IS NULL
       OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{16,128}$' THEN
        RAISE EXCEPTION 'Invalid withdrawal replay lookup payload.'
            USING ERRCODE = '22023';
    END IF;

    v_request := pg_catalog.jsonb_build_object(
        'user_id', p_user_id,
        'network', CASE upper(pg_catalog.btrim(p_network))
            WHEN 'ETH' THEN 'ERC20'
            WHEN 'ETHEREUM' THEN 'ERC20'
            WHEN 'TRON' THEN 'TRC20'
            WHEN 'BSC' THEN 'BEP20'
            WHEN 'BINANCE' THEN 'BEP20'
            ELSE upper(pg_catalog.btrim(p_network))
        END,
        'to_address', pg_catalog.btrim(p_to_address),
        'amount', p_amount,
        'asset', upper(pg_catalog.btrim(p_asset))
    );
    v_request_hash := pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(v_request::TEXT, 'UTF8')),
        'hex'
    );

    SELECT *
      INTO v_existing
      FROM public.financial_idempotency_keys
     WHERE user_id = p_user_id
       AND idempotency_key = p_idempotency_key
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('found', FALSE);
    END IF;

    IF v_existing.action_type IS DISTINCT FROM 'withdrawal_request'
       OR v_existing.request_hash IS DISTINCT FROM v_request_hash THEN
        RAISE EXCEPTION 'Idempotency key was used for different withdrawal details.'
            USING ERRCODE = '23505';
    END IF;

    IF v_existing.status = 'COMPLETED'
       AND v_existing.response_payload IS NOT NULL
       AND v_existing.response_payload->>'success' = 'true' THEN
        RETURN pg_catalog.jsonb_build_object(
            'found', TRUE,
            'response', v_existing.response_payload || pg_catalog.jsonb_build_object('idempotent_replay', TRUE)
        );
    END IF;

    RAISE EXCEPTION 'Withdrawal request is already in progress.'
        USING ERRCODE = '55P03';
END;
$function$;

ALTER FUNCTION public.get_withdrawal_idempotency_replay(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT)
    OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_withdrawal_idempotency_replay(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.get_withdrawal_idempotency_replay(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT)
    TO service_role, postgres;

COMMENT ON FUNCTION public.get_withdrawal_idempotency_replay(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT) IS
    'Returns a previously completed withdrawal receipt with the same request fingerprint before the service depends on live gas/market feeds; service-role only.';

COMMIT;
