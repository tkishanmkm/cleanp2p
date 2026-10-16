-- Bound worker batch size so a misconfigured or compromised worker cannot
-- claim an unbounded number of withdrawals in one call.
CREATE OR REPLACE FUNCTION public.claim_pending_withdrawals(p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
    id UUID,
    user_id UUID,
    wallet_id UUID,
    asset_symbol TEXT,
    amount NUMERIC,
    destination_address TEXT,
    to_address TEXT,
    network TEXT,
    status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
        RAISE EXCEPTION 'Withdrawal claim limit must be between 1 and 100';
    END IF;

    RETURN QUERY
    WITH claimed AS (
        SELECT w.id
        FROM public.withdrawals w
        WHERE w.status IN ('QUEUED', 'approved', 'PENDING')
          AND NOT EXISTS (
              SELECT 1
              FROM public.wallets wal
              WHERE wal.id = w.wallet_id
                AND (wal.status IS DISTINCT FROM 'active'
                     OR wal.provisioning_status IS DISTINCT FROM 'completed')
          )
          AND NOT EXISTS (
              SELECT 1
              FROM auth.users u
              WHERE u.id = w.user_id
                AND (
                    COALESCE(u.banned_until > NOW(), FALSE)
                    OR COALESCE((u.raw_app_meta_data ->> 'restricted')::boolean, FALSE)
                )
          )
        ORDER BY w.created_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.withdrawals w
    SET status = 'processing',
        updated_at = NOW()
    FROM claimed
    WHERE w.id = claimed.id
    RETURNING
        w.id,
        w.user_id,
        w.wallet_id,
        w.asset_symbol,
        w.amount,
        w.destination_address,
        w.destination_address AS to_address,
        w.network,
        w.status;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_pending_withdrawals(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_pending_withdrawals(INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.claim_pending_withdrawals(INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_withdrawals(INTEGER) TO service_role;
COMMENT ON FUNCTION public.claim_pending_withdrawals(INTEGER) IS
  'Worker-only RPC: atomically claims 1-100 queued withdrawals. Execute only as service_role.';
