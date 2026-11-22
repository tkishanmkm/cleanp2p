-- Restore the idempotent withdrawal reservation contract required by the
-- canonical withdrawal service. This uses a dedicated server-only table because
-- the deployed withdrawals table does not contain an idempotency_key column.
BEGIN;

CREATE TABLE IF NOT EXISTS public.withdrawal_idempotency_keys (
    user_id UUID NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    withdrawal_id UUID NOT NULL,
    response JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT withdrawal_idempotency_keys_pkey PRIMARY KEY (user_id, idempotency_key)
);

ALTER TABLE public.withdrawal_idempotency_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.withdrawal_idempotency_keys FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.withdrawal_idempotency_keys TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.request_withdrawal_idempotent(
    p_user_id UUID,
    p_network TEXT,
    p_to_address TEXT,
    p_amount NUMERIC(36, 18),
    p_fee NUMERIC(36, 18),
    p_asset TEXT,
    p_usd_equivalent NUMERIC(18, 2),
    p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_existing public.withdrawal_idempotency_keys%ROWTYPE;
    v_fingerprint TEXT;
    v_result JSONB;
    v_withdrawal_id UUID;
BEGIN
    IF p_user_id IS NULL OR p_idempotency_key IS NULL
       OR length(p_idempotency_key) < 8 OR length(p_idempotency_key) > 128
       OR p_idempotency_key !~ '^[A-Za-z0-9._:-]+$'
       OR p_amount IS NULL OR p_amount <= 0
       OR NULLIF(BTRIM(p_network), '') IS NULL
       OR NULLIF(BTRIM(p_to_address), '') IS NULL
       OR NULLIF(BTRIM(p_asset), '') IS NULL THEN
        RAISE EXCEPTION 'A valid withdrawal request and idempotency key are required';
    END IF;

    -- The fingerprint intentionally excludes server-derived gas fee and USD price:
    -- both may change during an ambiguous retry without changing user intent.
    v_fingerprint := md5(concat_ws('|',
        UPPER(BTRIM(p_network)),
        BTRIM(p_to_address),
        p_amount::TEXT,
        UPPER(BTRIM(p_asset))
    ));

    -- Serialize same-user reservation attempts and replays.
    PERFORM 1 FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'User profile not found';
    END IF;

    SELECT * INTO v_existing
    FROM public.withdrawal_idempotency_keys
    WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
            RAISE EXCEPTION 'IDEMPOTENCY_KEY_CONFLICT';
        END IF;
        RETURN v_existing.response;
    END IF;

    v_result := public.request_withdrawal(
        p_user_id := p_user_id,
        p_network := p_network,
        p_to_address := p_to_address,
        p_amount := p_amount,
        p_fee := p_fee,
        p_asset := p_asset,
        p_usd_equivalent := p_usd_equivalent
    );

    IF COALESCE((v_result->>'success')::BOOLEAN, FALSE) IS NOT TRUE
       OR COALESCE(v_result->>'withdrawal_id', '') = '' THEN
        RAISE EXCEPTION 'Withdrawal reservation returned an invalid result';
    END IF;

    v_withdrawal_id := (v_result->>'withdrawal_id')::UUID;

    INSERT INTO public.withdrawal_idempotency_keys (
        user_id, idempotency_key, request_fingerprint, withdrawal_id, response
    ) VALUES (
        p_user_id, p_idempotency_key, v_fingerprint, v_withdrawal_id, v_result
    );

    RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.request_withdrawal_idempotent(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_withdrawal_idempotent(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT)
    TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.lookup_withdrawal_idempotency_replay(
    p_user_id UUID,
    p_idempotency_key TEXT,
    p_network TEXT,
    p_to_address TEXT,
    p_amount NUMERIC(36, 18),
    p_asset TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_existing public.withdrawal_idempotency_keys%ROWTYPE;
    v_fingerprint TEXT;
BEGIN
    IF p_user_id IS NULL OR p_idempotency_key IS NULL
       OR length(p_idempotency_key) < 8 OR length(p_idempotency_key) > 128
       OR p_idempotency_key !~ '^[A-Za-z0-9._:-]+$'
       OR p_amount IS NULL OR p_amount <= 0
       OR NULLIF(BTRIM(p_network), '') IS NULL
       OR NULLIF(BTRIM(p_to_address), '') IS NULL
       OR NULLIF(BTRIM(p_asset), '') IS NULL THEN
        RAISE EXCEPTION 'Invalid withdrawal replay lookup input';
    END IF;

    v_fingerprint := md5(concat_ws('|',
        UPPER(BTRIM(p_network)),
        BTRIM(p_to_address),
        p_amount::TEXT,
        UPPER(BTRIM(p_asset))
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
$function$;

REVOKE ALL ON FUNCTION public.lookup_withdrawal_idempotency_replay(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_withdrawal_idempotency_replay(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT)
    TO service_role, postgres;

COMMIT;
