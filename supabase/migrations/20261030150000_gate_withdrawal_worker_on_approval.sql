-- Ensure the approval RPC's server-managed fields exist in environments where
-- the withdrawals table predates the approval workflow.
ALTER TABLE public.withdrawals
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- Only dispatch withdrawals whose canonical request row is QUEUED. Requests
-- requiring approval must also have both approval fields populated. A missing
-- or mismatched withdrawals row is deliberately not claimable.
CREATE OR REPLACE FUNCTION public.claim_pending_withdrawals(p_limit integer DEFAULT 10)
RETURNS SETOF public.onchain_withdrawals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 1), 1), 50);
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT ow.id
    FROM public.onchain_withdrawals AS ow
    JOIN public.withdrawals AS w ON w.id = ow.id
    WHERE ow.status = 'PENDING'
      AND UPPER(COALESCE(w.status, '')) = 'QUEUED'
      AND (
        COALESCE(w.requires_admin_approval, false) = false
        OR (w.approved_by IS NOT NULL AND w.approved_at IS NOT NULL)
      )
    ORDER BY ow.created_at ASC
    LIMIT v_limit
    FOR UPDATE OF ow SKIP LOCKED
  )
  UPDATE public.onchain_withdrawals AS ow
  SET status = 'PROCESSING',
      updated_at = NOW()
  FROM claimed AS c
  WHERE ow.id = c.id
  RETURNING ow.*;
END;
$function$;

-- This queue-claim RPC is an internal worker capability, not a user RPC.
REVOKE ALL ON FUNCTION public.claim_pending_withdrawals(integer)
  FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.claim_pending_withdrawals(integer)
  TO service_role;
