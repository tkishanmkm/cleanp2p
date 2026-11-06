-- Aggregate Paxones liabilities using the live canonical wallet accounting schema.
-- Return exact decimal strings so PostgREST/JavaScript cannot round NUMERIC values.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_withdrawal_reconciliation_totals(
    p_asset_symbol text
)
RETURNS TABLE (
    total_user_liability text,
    total_pending_withdrawals text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_asset text := upper(pg_catalog.btrim(coalesce(p_asset_symbol, '')));
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Service role required for financial reconciliation totals'
            USING ERRCODE = '42501';
    END IF;

    IF v_asset !~ '^[A-Z0-9]{2,20}$' THEN
        RAISE EXCEPTION 'Invalid reconciliation asset symbol'
            USING ERRCODE = '22023';
    END IF;

    -- wallet_assets is the canonical wallet table. locked_balance is the
    -- mirrored representation of reserved_balance; count it once, not twice.
    -- A broken mirror or negative component makes the entire report fail closed.
    IF EXISTS (
        SELECT 1
        FROM public.wallet_assets wa
        WHERE upper(wa.asset_symbol) = v_asset
          AND (
              coalesce(wa.balance, 0) < 0
              OR coalesce(wa.locked_balance, 0) < 0
              OR coalesce(wa.reserved_balance, 0) < 0
              OR coalesce(wa.in_escrow, 0) < 0
              OR coalesce(wa.in_withdrawal, 0) < 0
              OR coalesce(wa.locked_balance, 0)
                    IS DISTINCT FROM coalesce(wa.reserved_balance, 0)
          )
    ) THEN
        RAISE EXCEPTION 'Canonical wallet accounting invariant failed for asset %', v_asset
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.onchain_withdrawals w
        WHERE upper(w.asset_symbol) = v_asset
          AND upper(w.status) IN (
              'NEEDS_APPROVAL', 'PENDING_APPROVAL', 'QUEUED', 'PENDING',
              'PROCESSING', 'READY_TO_BROADCAST', 'AMBIGUOUS_BROADCAST',
              'BROADCASTED'
          )
          AND (coalesce(w.amount, 0) <= 0 OR coalesce(w.fee, 0) < 0)
    ) THEN
        RAISE EXCEPTION 'Active withdrawal amount or fee invariant failed for asset %', v_asset
            USING ERRCODE = '23514';
    END IF;

    RETURN QUERY
    SELECT
        coalesce((
            SELECT sum(
                coalesce(wa.balance, 0)
                + coalesce(wa.locked_balance, 0)
                + coalesce(wa.in_escrow, 0)
                + coalesce(wa.in_withdrawal, 0)
            )
            FROM public.wallet_assets wa
            WHERE upper(wa.asset_symbol) = v_asset
        ), 0)::text,
        coalesce((
            SELECT sum(w.amount + coalesce(w.fee, 0))
            FROM public.onchain_withdrawals w
            WHERE upper(w.asset_symbol) = v_asset
              AND upper(w.status) IN (
                  'NEEDS_APPROVAL', 'PENDING_APPROVAL', 'QUEUED', 'PENDING',
                  'PROCESSING', 'READY_TO_BROADCAST', 'AMBIGUOUS_BROADCAST',
                  'BROADCASTED'
              )
        ), 0)::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_withdrawal_reconciliation_totals(text)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.get_withdrawal_reconciliation_totals(text)
    TO service_role, postgres;

COMMENT ON FUNCTION public.get_withdrawal_reconciliation_totals(text) IS
    'Read-only service-role aggregate over canonical wallet_assets and active onchain_withdrawals; returns exact NUMERIC values as decimal text.';

NOTIFY pgrst, 'reload schema';

COMMIT;
