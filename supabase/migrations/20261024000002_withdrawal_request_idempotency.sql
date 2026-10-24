-- Make withdrawal HTTP retries idempotent without guessing from amount/address.
-- A caller-provided key is scoped to the authenticated user and locked atomically.
CREATE TABLE IF NOT EXISTS public.withdrawal_idempotency_requests (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,
    withdrawal_id UUID NOT NULL REFERENCES public.withdrawals(id) ON DELETE CASCADE,
    asset_symbol TEXT NOT NULL,
    network_code TEXT NOT NULL,
    destination_address TEXT NOT NULL,
    amount NUMERIC(36, 18) NOT NULL,
    network_fee NUMERIC(36, 18) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, idempotency_key),
    UNIQUE (withdrawal_id),
    CONSTRAINT withdrawal_idempotency_key_length CHECK (char_length(idempotency_key) BETWEEN 8 AND 200)
);

ALTER TABLE public.withdrawal_idempotency_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.withdrawal_idempotency_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.withdrawal_idempotency_requests TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.request_withdrawal_idempotent(
    p_user_id UUID,
    p_network TEXT,
    p_to_address TEXT,
    p_amount NUMERIC(36, 18),
    p_fee NUMERIC(36, 18),
    p_asset TEXT DEFAULT 'USDT',
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_key TEXT := BTRIM(COALESCE(p_idempotency_key, ''));
    v_asset TEXT := UPPER(BTRIM(COALESCE(p_asset, 'USDT')));
    v_network TEXT := UPPER(BTRIM(COALESCE(p_network, '')));
    v_address TEXT := BTRIM(COALESCE(p_to_address, ''));
    v_existing public.withdrawal_idempotency_requests%ROWTYPE;
    v_withdrawal_id UUID;
    v_status TEXT;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'User ID is required';
    END IF;
    IF char_length(v_key) < 8 OR char_length(v_key) > 200 THEN
        RAISE EXCEPTION 'Idempotency key must contain between 8 and 200 characters';
    END IF;
    IF v_address = '' OR p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Valid destination address and positive amount are required';
    END IF;
    IF p_fee IS NULL OR p_fee < 0 THEN
        RAISE EXCEPTION 'Withdrawal fee must not be negative';
    END IF;

    -- Serialize retries using the same user/key pair before checking the map.
    PERFORM pg_advisory_xact_lock(hashtext(p_user_id::TEXT), hashtext(v_key));

    SELECT * INTO v_existing
    FROM public.withdrawal_idempotency_requests
    WHERE user_id = p_user_id AND idempotency_key = v_key
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing.asset_symbol IS DISTINCT FROM v_asset
           OR v_existing.network_code IS DISTINCT FROM v_network
           OR v_existing.destination_address IS DISTINCT FROM v_address
           OR v_existing.amount IS DISTINCT FROM p_amount
           OR v_existing.network_fee IS DISTINCT FROM p_fee THEN
            RAISE EXCEPTION 'Idempotency key was already used for a different withdrawal request';
        END IF;

        SELECT status INTO v_status
        FROM public.withdrawals
        WHERE id = v_existing.withdrawal_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Idempotent withdrawal record is missing; manual reconciliation required';
        END IF;

        RETURN jsonb_build_object(
            'withdrawal_id', v_existing.withdrawal_id,
            'status', v_status,
            'replayed', TRUE
        );
    END IF;

    v_withdrawal_id := public.request_withdrawal(
        p_user_id := p_user_id,
        p_network := p_network,
        p_to_address := p_to_address,
        p_amount := p_amount,
        p_fee := p_fee,
        p_asset := v_asset
    );

    SELECT status INTO v_status
    FROM public.withdrawals
    WHERE id = v_withdrawal_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Withdrawal reservation returned no matching record';
    END IF;

    INSERT INTO public.withdrawal_idempotency_requests (
        user_id, idempotency_key, withdrawal_id, asset_symbol,
        network_code, destination_address, amount, network_fee
    ) VALUES (
        p_user_id, v_key, v_withdrawal_id, v_asset,
        v_network, v_address, p_amount, p_fee
    );

    RETURN jsonb_build_object(
        'withdrawal_id', v_withdrawal_id,
        'status', v_status,
        'replayed', FALSE
    );
END;
$$;

REVOKE ALL ON FUNCTION public.request_withdrawal_idempotent(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_withdrawal_idempotent(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT) TO service_role, postgres;
