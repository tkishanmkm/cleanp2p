-- Atomically persist a known on-chain transaction hash to both withdrawal records.
-- This migration is source-only until validated and explicitly applied to a disposable database.
-- Both worker tables must permit the AMBIGUOUS_BROADCAST recovery state.
-- NOT VALID avoids failing immediately on legacy rows; PostgreSQL still checks new/updated rows.
ALTER TABLE public.onchain_withdrawals
    DROP CONSTRAINT IF EXISTS onchain_withdrawals_status_check;
ALTER TABLE public.onchain_withdrawals
    ADD CONSTRAINT onchain_withdrawals_status_check
    CHECK (UPPER(status) IN ('NEEDS_APPROVAL', 'PENDING_APPROVAL', 'PENDING', 'PROCESSING', 'BROADCASTED', 'AMBIGUOUS_BROADCAST', 'CONFIRMED', 'COMPLETED', 'FAILED', 'CANCELLED')) NOT VALID;

ALTER TABLE public.withdrawals
    DROP CONSTRAINT IF EXISTS withdrawals_status_check;
ALTER TABLE public.withdrawals
    ADD CONSTRAINT withdrawals_status_check
    CHECK (UPPER(status) IN ('QUEUED', 'PENDING', 'PENDING_APPROVAL', 'APPROVED', 'PROCESSING', 'BROADCASTING', 'BROADCASTED', 'AMBIGUOUS_BROADCAST', 'COMPLETED', 'FAILED', 'REJECTED', 'CANCELLED')) NOT VALID;

CREATE OR REPLACE FUNCTION public.record_withdrawal_broadcast(
    p_withdrawal_id UUID,
    p_tx_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_onchain_status TEXT;
    v_withdrawal_status TEXT;
    v_onchain_hash TEXT;
    v_withdrawal_hash TEXT;
    v_withdrawal_txid TEXT;
    v_rows INTEGER;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF p_withdrawal_id IS NULL THEN
        RAISE EXCEPTION 'Withdrawal ID is required';
    END IF;
    IF p_tx_hash IS NULL OR LENGTH(BTRIM(p_tx_hash)) = 0 OR LENGTH(BTRIM(p_tx_hash)) > 256 THEN
        RAISE EXCEPTION 'A valid transaction hash is required';
    END IF;

    -- Match refund/approval lock order: user-facing withdrawal first, then on-chain row.
    -- A consistent order prevents avoidable deadlocks between broadcast recording and refunds.
    SELECT status, tx_hash, txid INTO v_withdrawal_status, v_withdrawal_hash, v_withdrawal_txid
    FROM public.withdrawals
    WHERE id = p_withdrawal_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Withdrawal record % not found', p_withdrawal_id;
    END IF;

    SELECT status, tx_hash INTO v_onchain_status, v_onchain_hash
    FROM public.onchain_withdrawals
    WHERE id = p_withdrawal_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'On-chain withdrawal % not found', p_withdrawal_id;
    END IF;

    -- A persisted transaction hash is immutable: retries must never replace a different on-chain transaction.
    IF (v_onchain_hash IS NOT NULL AND BTRIM(v_onchain_hash) <> BTRIM(p_tx_hash))
       OR (v_withdrawal_hash IS NOT NULL AND BTRIM(v_withdrawal_hash) <> BTRIM(p_tx_hash))
       OR (v_withdrawal_txid IS NOT NULL AND BTRIM(v_withdrawal_txid) <> BTRIM(p_tx_hash)) THEN
        RAISE EXCEPTION 'Conflicting transaction hash exists for withdrawal %', p_withdrawal_id;
    END IF;

    -- Idempotent retry is allowed only for the same hash; never overwrite a different tx.
    IF UPPER(COALESCE(v_onchain_status, '')) = 'BROADCASTED'
       AND EXISTS (SELECT 1 FROM public.onchain_withdrawals WHERE id = p_withdrawal_id AND tx_hash = BTRIM(p_tx_hash))
       AND LOWER(COALESCE(v_withdrawal_status, '')) = 'processing'
       AND EXISTS (SELECT 1 FROM public.withdrawals WHERE id = p_withdrawal_id AND (tx_hash = BTRIM(p_tx_hash) OR txid = BTRIM(p_tx_hash))) THEN
        RETURN jsonb_build_object('success', true, 'withdrawal_id', p_withdrawal_id, 'tx_hash', BTRIM(p_tx_hash), 'status', 'BROADCASTED', 'idempotent', true);
    END IF;

    IF UPPER(COALESCE(v_onchain_status, '')) NOT IN ('PROCESSING', 'PENDING', 'BROADCASTED', 'AMBIGUOUS_BROADCAST') THEN
        RAISE EXCEPTION 'On-chain withdrawal % cannot be marked broadcast from status %', p_withdrawal_id, v_onchain_status;
    END IF;
    IF LOWER(COALESCE(v_withdrawal_status, '')) NOT IN ('pending', 'approved', 'queued', 'processing', 'broadcasting', 'broadcasted', 'ambiguous_broadcast') THEN
        RAISE EXCEPTION 'Withdrawal % cannot be marked broadcast from status %', p_withdrawal_id, v_withdrawal_status;
    END IF;

    UPDATE public.onchain_withdrawals
    SET status = 'BROADCASTED', tx_hash = BTRIM(p_tx_hash), updated_at = v_now
    WHERE id = p_withdrawal_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Could not persist on-chain broadcast state for withdrawal %', p_withdrawal_id;
    END IF;

    UPDATE public.withdrawals
    SET status = 'processing', tx_hash = BTRIM(p_tx_hash), txid = BTRIM(p_tx_hash), broadcasted_at = v_now, updated_at = v_now
    WHERE id = p_withdrawal_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Could not persist withdrawal broadcast state for %', p_withdrawal_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'withdrawal_id', p_withdrawal_id, 'tx_hash', BTRIM(p_tx_hash), 'status', 'BROADCASTED', 'idempotent', false);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_withdrawal_broadcast(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_withdrawal_broadcast(UUID, TEXT) TO service_role, postgres;

-- Atomically mark a post-dispatch uncertainty while retaining any known hash.
-- A different previously stored hash is a hard conflict and is never overwritten.
CREATE OR REPLACE FUNCTION public.record_ambiguous_withdrawal_broadcast(
    p_withdrawal_id UUID,
    p_tx_hash TEXT DEFAULT NULL,
    p_error TEXT DEFAULT 'Broadcast outcome is uncertain'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_onchain_status TEXT;
    v_withdrawal_status TEXT;
    v_onchain_hash TEXT;
    v_withdrawal_hash TEXT;
    v_withdrawal_txid TEXT;
    v_hash TEXT := NULLIF(BTRIM(p_tx_hash), '');
    v_error TEXT := LEFT(COALESCE(NULLIF(BTRIM(p_error), ''), 'Broadcast outcome is uncertain'), 1000);
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF p_withdrawal_id IS NULL THEN
        RAISE EXCEPTION 'Withdrawal ID is required';
    END IF;
    IF p_tx_hash IS NOT NULL AND (LENGTH(BTRIM(p_tx_hash)) = 0 OR LENGTH(BTRIM(p_tx_hash)) > 256) THEN
        RAISE EXCEPTION 'Transaction hash must be null or a non-empty value up to 256 characters';
    END IF;

    -- Keep the same lock order as refund and approval RPCs.
    SELECT status, tx_hash, txid INTO v_withdrawal_status, v_withdrawal_hash, v_withdrawal_txid
    FROM public.withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal record % not found', p_withdrawal_id; END IF;

    SELECT status, tx_hash INTO v_onchain_status, v_onchain_hash
    FROM public.onchain_withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'On-chain withdrawal % not found', p_withdrawal_id; END IF;

    IF UPPER(COALESCE(v_onchain_status, '')) IN ('COMPLETED', 'CONFIRMED', 'FAILED', 'CANCELLED')
       OR LOWER(COALESCE(v_withdrawal_status, '')) IN ('completed', 'failed', 'rejected', 'cancelled') THEN
        RAISE EXCEPTION 'Withdrawal % is terminal and cannot become ambiguous', p_withdrawal_id;
    END IF;

    IF v_hash IS NOT NULL AND (
        (v_onchain_hash IS NOT NULL AND BTRIM(v_onchain_hash) <> v_hash)
        OR (v_withdrawal_hash IS NOT NULL AND BTRIM(v_withdrawal_hash) <> v_hash)
        OR (v_withdrawal_txid IS NOT NULL AND BTRIM(v_withdrawal_txid) <> v_hash)
    ) THEN
        RAISE EXCEPTION 'Conflicting transaction hash exists for withdrawal %', p_withdrawal_id;
    END IF;

    UPDATE public.onchain_withdrawals
    SET status = 'AMBIGUOUS_BROADCAST',
        tx_hash = COALESCE(v_hash, tx_hash),
        error_message = v_error,
        updated_at = v_now
    WHERE id = p_withdrawal_id;

    UPDATE public.withdrawals
    SET status = 'AMBIGUOUS_BROADCAST',
        tx_hash = COALESCE(v_hash, tx_hash),
        txid = COALESCE(v_hash, txid),
        broadcast_error = v_error,
        updated_at = v_now
    WHERE id = p_withdrawal_id;

    RETURN jsonb_build_object('success', true, 'withdrawal_id', p_withdrawal_id,
        'tx_hash', COALESCE(v_hash, v_onchain_hash, v_withdrawal_hash, v_withdrawal_txid),
        'status', 'AMBIGUOUS_BROADCAST');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_ambiguous_withdrawal_broadcast(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ambiguous_withdrawal_broadcast(UUID, TEXT, TEXT) TO service_role, postgres;
