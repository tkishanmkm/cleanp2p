-- Read-only lookup for an exact retry of a previously reserved withdrawal.
-- Local source change only; validate with a clean PostgreSQL migration replay before use.
BEGIN;

CREATE OR REPLACE FUNCTION public.lookup_withdrawal_idempotency_replay(
    p_user_id UUID,
    p_idempotency_key TEXT,
    p_network TEXT,
    p_to_address TEXT,
    p_amount NUMERIC(36,18),
    p_asset TEXT
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_existing public.withdrawal_idempotency_keys%ROWTYPE;
    v_fingerprint TEXT;
BEGIN
    IF p_user_id IS NULL OR p_idempotency_key IS NULL
       OR length(p_idempotency_key) < 8 OR length(p_idempotency_key) > 128
       OR p_idempotency_key !~ '^[A-Za-z0-9._:-]+$'
       OR p_amount IS NULL OR p_amount <= 0
       OR NULLIF(TRIM(p_network), '') IS NULL
       OR NULLIF(TRIM(p_to_address), '') IS NULL THEN
        RAISE EXCEPTION 'Invalid withdrawal replay lookup input';
    END IF;

    v_fingerprint := md5(concat_ws('|',
        UPPER(TRIM(COALESCE(p_network, ''))),
        TRIM(COALESCE(p_to_address, '')),
        p_amount::TEXT,
        UPPER(TRIM(COALESCE(p_asset, 'USDT')))
    ));

    SELECT * INTO v_existing
    FROM public.withdrawal_idempotency_keys
    WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('found', FALSE);
    END IF;

    IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_CONFLICT';
    END IF;

    RETURN jsonb_build_object('found', TRUE, 'response', v_existing.response);
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_withdrawal_idempotency_replay(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_withdrawal_idempotency_replay(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT)
TO service_role, postgres;

COMMIT;
