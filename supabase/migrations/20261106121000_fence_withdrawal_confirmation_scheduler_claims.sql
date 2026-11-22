-- Make confirmation scheduling a database compare-and-set claim.
-- Two worker instances may read the same due row, but only one may move its
-- next_confirmation_check_at forward and receive a successful claim result.
BEGIN;

ALTER TABLE public.onchain_withdrawals
    ADD COLUMN IF NOT EXISTS next_confirmation_check_at timestamptz
    NOT NULL DEFAULT pg_catalog.clock_timestamp();

UPDATE public.onchain_withdrawals
SET next_confirmation_check_at = pg_catalog.clock_timestamp()
WHERE next_confirmation_check_at IS NULL;

ALTER TABLE public.onchain_withdrawals
    ALTER COLUMN next_confirmation_check_at SET DEFAULT pg_catalog.clock_timestamp(),
    ALTER COLUMN next_confirmation_check_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_onchain_withdrawals_confirmation_due
    ON public.onchain_withdrawals (next_confirmation_check_at, created_at, id)
    WHERE status IN ('BROADCASTED', 'PROCESSING', 'AMBIGUOUS_BROADCAST')
      AND tx_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.schedule_withdrawal_confirmation_check(
    p_withdrawal_id uuid,
    p_tx_hash text,
    p_next_check_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_hash text := lower(pg_catalog.btrim(coalesce(p_tx_hash, '')));
    v_claimed_id uuid;
    v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Service role required to schedule withdrawal confirmation checks'
            USING ERRCODE = '42501';
    END IF;

    IF p_withdrawal_id IS NULL
       OR v_hash = ''
       OR pg_catalog.length(v_hash) > 160
       OR p_next_check_at IS NULL
       OR p_next_check_at <= v_now
       OR p_next_check_at > v_now + interval '15 minutes' THEN
        RAISE EXCEPTION 'Invalid withdrawal confirmation scheduling payload'
            USING ERRCODE = '22023';
    END IF;

    -- The due-time predicate is the fencing condition. Concurrent callers that
    -- previously selected the same due row serialize on this UPDATE; after the
    -- first commits its future timestamp, the next caller no longer matches.
    UPDATE public.onchain_withdrawals
    SET next_confirmation_check_at = p_next_check_at
    WHERE id = p_withdrawal_id
      AND lower(tx_hash) = v_hash
      AND status IN ('BROADCASTED', 'PROCESSING', 'AMBIGUOUS_BROADCAST')
      AND next_confirmation_check_at <= v_now
    RETURNING id INTO v_claimed_id;

    RETURN v_claimed_id IS NOT NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.schedule_withdrawal_confirmation_check(uuid, text, timestamptz)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.schedule_withdrawal_confirmation_check(uuid, text, timestamptz)
    TO service_role, postgres;

COMMENT ON FUNCTION public.schedule_withdrawal_confirmation_check(uuid, text, timestamptz) IS
    'Service-only compare-and-set claim for one due withdrawal confirmation pass; only one concurrent worker can advance the schedule.';

NOTIFY pgrst, 'reload schema';

COMMIT;
