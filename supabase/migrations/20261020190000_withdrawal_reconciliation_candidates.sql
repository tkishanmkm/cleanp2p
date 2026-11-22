-- Read-only recovery aid: identify stale withdrawal pairs for manual reconciliation.
-- This deliberately does not reset statuses, refund balances, or rebroadcast transactions.
-- Validate against an isolated schema before deployment.
BEGIN;

CREATE OR REPLACE FUNCTION public.list_stale_withdrawal_reconciliation_candidates(
    p_min_age_minutes INTEGER DEFAULT 15
)
RETURNS TABLE (
    withdrawal_id UUID,
    user_id UUID,
    onchain_status TEXT,
    withdrawal_status TEXT,
    onchain_tx_hash TEXT,
    withdrawal_tx_hash TEXT,
    withdrawal_txid TEXT,
    onchain_updated_at TIMESTAMPTZ,
    withdrawal_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_min_age_minutes IS NULL OR p_min_age_minutes < 1 OR p_min_age_minutes > 10080 THEN
        RAISE EXCEPTION 'p_min_age_minutes must be between 1 and 10080';
    END IF;

    RETURN QUERY
    SELECT
        COALESCE(o.id, w.id),
        COALESCE(o.user_id, w.user_id),
        o.status,
        w.status,
        o.tx_hash,
        w.tx_hash,
        w.txid,
        o.updated_at,
        w.updated_at
    FROM public.onchain_withdrawals AS o
    FULL OUTER JOIN public.withdrawals AS w ON w.id = o.id
    WHERE (
        o.id IS NULL
        OR w.id IS NULL
        OR UPPER(COALESCE(o.status, '')) IN ('PROCESSING', 'BROADCASTED', 'AMBIGUOUS_BROADCAST')
        OR LOWER(COALESCE(w.status, '')) IN ('processing', 'broadcasting', 'broadcasted', 'ambiguous_broadcast')
        OR (o.id IS NOT NULL AND w.id IS NOT NULL AND (
            o.tx_hash IS DISTINCT FROM w.tx_hash
            OR (w.txid IS NOT NULL AND w.txid IS DISTINCT FROM COALESCE(w.tx_hash, o.tx_hash))
        ))
    )
      AND COALESCE(LEAST(o.updated_at, w.updated_at), o.updated_at, w.updated_at)
          < NOW() - make_interval(mins => p_min_age_minutes)
    ORDER BY COALESCE(LEAST(o.updated_at, w.updated_at), o.updated_at, w.updated_at) ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_stale_withdrawal_reconciliation_candidates(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_stale_withdrawal_reconciliation_candidates(INTEGER) TO service_role, postgres;

COMMIT;
