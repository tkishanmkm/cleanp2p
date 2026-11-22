-- Claim persisted/ambiguous sweeps for reconciliation without starting a new sweep.
-- Preserve the live SETOF sweep_operations return contract (the worker consumes id).
-- Hashless recovery is allowed only for verifiable pre-broadcast TRON resource cleanup.

BEGIN;

CREATE OR REPLACE FUNCTION public.claim_next_sweep_reconciliation(
    p_worker_id TEXT,
    p_lease_duration_seconds INTEGER DEFAULT 300
)
RETURNS SETOF public.sweep_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_sweep_id UUID;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Service role required to claim sweep reconciliation'
            USING ERRCODE = '42501';
    END IF;

    IF p_worker_id IS NULL
       OR pg_catalog.btrim(p_worker_id) = ''
       OR pg_catalog.length(p_worker_id) > 128
       OR p_lease_duration_seconds IS NULL
       OR p_lease_duration_seconds < 30
       OR p_lease_duration_seconds > 1800 THEN
        RAISE EXCEPTION 'Invalid sweep reconciliation lease request'
            USING ERRCODE = '22023';
    END IF;

    SELECT s.id
      INTO v_sweep_id
    FROM public.sweep_operations AS s
    WHERE s.status IN ('GAS_FUNDING', 'GAS_FUNDED', 'READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED')
      AND (
        (
          s.status IN ('READY_TO_BROADCAST', 'BROADCASTED')
          OR (
            s.status = 'RECOVERY_REQUIRED'
            AND nullif(pg_catalog.btrim(coalesce(s.sweep_tx_hash, '')), '') IS NOT NULL
            AND nullif(pg_catalog.btrim(coalesce(s.signed_tx_hex, '')), '') IS NOT NULL
          )
        )
        AND nullif(pg_catalog.btrim(coalesce(s.sweep_tx_hash, '')), '') IS NOT NULL
        AND nullif(pg_catalog.btrim(coalesce(s.signed_tx_hex, '')), '') IS NOT NULL
        OR (
          s.status IN ('GAS_FUNDING', 'GAS_FUNDED')
          AND upper(pg_catalog.btrim(coalesce(s.network, ''))) IN (
            'ERC20', 'BEP20', 'ETH', 'BSC', 'ETHEREUM', 'BINANCE'
          )
        )
        OR (
          s.status = 'RECOVERY_REQUIRED'
          AND upper(pg_catalog.btrim(coalesce(s.network, ''))) IN ('TRC20', 'TRON')
          AND nullif(pg_catalog.btrim(coalesce(s.sweep_tx_hash, '')), '') IS NULL
          AND nullif(pg_catalog.btrim(coalesce(s.signed_tx_hex, '')), '') IS NULL
          AND EXISTS (
            SELECT 1
            FROM public.resource_delegation_operations AS r
            WHERE r.sweep_id = s.id
              AND upper(coalesce(r.status, '')) IN ('DELEGATED', 'UNDELEGATING')
              AND coalesce(r.verified_onchain_undelegated, false) = false
          )
        )
      )
      AND (s.lease_expires_at IS NULL OR s.lease_expires_at <= pg_catalog.clock_timestamp())
    ORDER BY
      CASE s.status
        WHEN 'READY_TO_BROADCAST' THEN 0
        WHEN 'BROADCASTED' THEN 1
        ELSE 2
      END,
      s.updated_at ASC,
      s.id ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_sweep_id IS NULL THEN
      RETURN;
    END IF;

    UPDATE public.sweep_operations
    SET worker_id = p_worker_id,
        lease_expires_at = pg_catalog.clock_timestamp()
          + pg_catalog.make_interval(secs => p_lease_duration_seconds),
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_sweep_id
      AND status IN ('GAS_FUNDING', 'GAS_FUNDED', 'READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED')
      AND (lease_expires_at IS NULL OR lease_expires_at <= pg_catalog.clock_timestamp());

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Sweep reconciliation lease could not be assigned'
        USING ERRCODE = '55000';
    END IF;

    RETURN QUERY
    SELECT s.*
    FROM public.sweep_operations AS s
    WHERE s.id = v_sweep_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_sweep_reconciliation(TEXT, INTEGER)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.claim_next_sweep_reconciliation(TEXT, INTEGER)
    TO service_role, postgres;

COMMENT ON FUNCTION public.claim_next_sweep_reconciliation(TEXT, INTEGER) IS
    'Service-only atomic lease for persisted sweep reconciliation. Returns the sweep_operations row; hashless claims are limited to pre-broadcast TRON resource cleanup.';

COMMIT;
