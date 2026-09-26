-- ============================================================================
-- Supabase Migration: 20260925000010_harden_utxo_reservations_rpc.sql
-- Description: Blocker #5 Fix - Secure atomic reservation of UTXOs for BTC/LTC
--              1. Replaces public.reserve_utxos_for_sweep() with a fail-closed,
--                 concurrency-safe version.
--              2. Eliminates unsafe concurrent overwrites by checking owned
--                 and distinct reservation counts.
--              3. Restricts overrides of reservations using ON CONFLICT WHERE.
--              4. Ensures whole-batch transactional rollback if any UTXO conflicts.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.reserve_utxos_for_sweep(
    p_sweep_id UUID,
    p_network TEXT,
    p_utxos JSONB,
    p_lease_seconds INTEGER DEFAULT 300
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_rec RECORD;
    v_until TIMESTAMPTZ := NOW() + (p_lease_seconds || ' seconds')::INTERVAL;
    v_distinct_input_count INTEGER;
    v_owned_count INTEGER;
BEGIN
    -- 1. Check input array is not null or empty
    IF p_utxos IS NULL OR jsonb_array_length(p_utxos) = 0 THEN
        RETURN jsonb_build_object('success', true, 'count', 0);
    END IF;

    -- 2. Calculate the distinct number of UTXOs in the input to support deduplication
    SELECT COUNT(*) INTO v_distinct_input_count
    FROM (
        SELECT DISTINCT (u->>'txid')::TEXT AS txid, (u->>'vout')::INTEGER AS vout
        FROM jsonb_array_elements(p_utxos) u
    ) d;

    -- 3. Purge expired RESERVED reservations
    DELETE FROM public.utxo_reservations
    WHERE reserved_until < NOW()
      AND status = 'RESERVED';

    -- 4. Try to insert or update each distinct UTXO atomically.
    -- If there's an existing reservation, we ONLY update it if:
    -- - It is RELEASED
    -- - It is RESERVED and expired (un-broadcasted and un-confirmed)
    -- - It is already owned by our p_sweep_id (extending lease)
    FOR v_rec IN 
        SELECT DISTINCT (u->>'txid')::TEXT AS txid, (u->>'vout')::INTEGER AS vout
        FROM jsonb_array_elements(p_utxos) u
    LOOP
        INSERT INTO public.utxo_reservations (txid, vout, network, sweep_id, status, reserved_until)
        VALUES (v_rec.txid, v_rec.vout, UPPER(TRIM(p_network)), p_sweep_id, 'RESERVED', v_until)
        ON CONFLICT (txid, vout, network)
        DO UPDATE SET 
            sweep_id = EXCLUDED.sweep_id,
            status = 'RESERVED',
            reserved_until = EXCLUDED.reserved_until
        WHERE (
            -- Rule A: existing reservation is RELEASED
            utxo_reservations.status = 'RELEASED'
            -- Rule B: existing reservation is RESERVED and expired (reserved_until < NOW())
            OR (utxo_reservations.status = 'RESERVED' AND utxo_reservations.reserved_until < NOW())
            -- Rule C: existing reservation belongs to the same sweep (renewing/extending own)
            OR utxo_reservations.sweep_id = EXCLUDED.sweep_id
        );
    END LOOP;

    -- 5. Verify that we successfully own ALL distinct UTXOs in the input batch.
    -- If any UTXO could not be inserted or updated because it was actively reserved
    -- by another sweep (unexpired RESERVED, BROADCASTED, or RECOVERY_REQUIRED),
    -- its sweep_id will not match p_sweep_id.
    SELECT COUNT(*) INTO v_owned_count
    FROM public.utxo_reservations r
    WHERE r.sweep_id = p_sweep_id
      AND r.status = 'RESERVED'
      AND r.network = UPPER(TRIM(p_network))
      AND EXISTS (
          SELECT 1 
          FROM jsonb_array_elements(p_utxos) u
          WHERE (u->>'txid')::TEXT = r.txid 
            AND (u->>'vout')::INTEGER = r.vout
      );

    -- 6. Whole-batch Atomicity: If the owned count does not match the distinct input count,
    -- it means at least one UTXO has an active conflict. We must roll back.
    IF v_owned_count <> v_distinct_input_count THEN
        RAISE EXCEPTION 'UTXO_CONFLICT: One or more UTXOs are actively reserved or in recovery by another sweep';
    END IF;

    -- 7. Return success response
    RETURN jsonb_build_object('success', true, 'count', v_distinct_input_count);
END;
$$;

-- Revoke default PUBLIC privileges
REVOKE EXECUTE ON FUNCTION public.reserve_utxos_for_sweep(UUID, TEXT, JSONB, INTEGER) FROM PUBLIC, anon, authenticated;

-- Grant execution privileges to authorized roles
GRANT EXECUTE ON FUNCTION public.reserve_utxos_for_sweep(UUID, TEXT, JSONB, INTEGER) TO service_role, postgres;

COMMIT;
