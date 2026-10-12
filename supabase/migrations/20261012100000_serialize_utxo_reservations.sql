-- Serialize UTXO reservations by chain/outpoint. Never transfer a live
-- reservation to a different sweep, and reject malformed/duplicate outpoints.
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
SET search_path = ''
AS $$
DECLARE
    v_utxo JSONB;
    v_txid TEXT;
    v_vout INTEGER;
    v_network TEXT := UPPER(TRIM(COALESCE(p_network, '')));
    v_until TIMESTAMPTZ;
    v_count INTEGER := 0;
BEGIN
    IF p_sweep_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.sweep_operations s WHERE s.id = p_sweep_id
    ) THEN
        RETURN jsonb_build_object('success', false, 'code', 'SWEEP_NOT_FOUND');
    END IF;

    IF v_network NOT IN ('BTC', 'LTC') THEN
        RETURN jsonb_build_object('success', false, 'code', 'UNSUPPORTED_NETWORK');
    END IF;

    IF p_utxos IS NULL OR jsonb_typeof(p_utxos) <> 'array'
       OR jsonb_array_length(p_utxos) = 0 THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_UTXOS');
    END IF;

    IF p_lease_seconds IS NULL OR p_lease_seconds < 1 OR p_lease_seconds > 3600 THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_LEASE');
    END IF;

    -- Validate all fields before acquiring locks or mutating reservations.
    FOR v_utxo IN
        SELECT value FROM jsonb_array_elements(p_utxos) AS item(value)
    LOOP
        IF jsonb_typeof(v_utxo) <> 'object' THEN
            RETURN jsonb_build_object('success', false, 'code', 'INVALID_UTXO');
        END IF;

        v_txid := LOWER(NULLIF(TRIM(v_utxo->>'txid'), ''));
        IF v_txid IS NULL OR v_txid !~ '^[0-9a-f]{64}$' THEN
            RETURN jsonb_build_object('success', false, 'code', 'INVALID_UTXO');
        END IF;

        IF COALESCE(v_utxo->>'vout', '') !~ '^[0-9]+$' THEN
            RETURN jsonb_build_object('success', false, 'code', 'INVALID_UTXO');
        END IF;

        BEGIN
            v_vout := (v_utxo->>'vout')::INTEGER;
        EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN
            RETURN jsonb_build_object('success', false, 'code', 'INVALID_UTXO');
        END;

        IF v_vout < 0 THEN
            RETURN jsonb_build_object('success', false, 'code', 'INVALID_UTXO');
        END IF;
    END LOOP;

    -- Duplicate outpoints in one request can corrupt amount/outpoint accounting.
    IF EXISTS (
        SELECT 1
        FROM (
            SELECT LOWER(TRIM(value->>'txid')) AS txid, (value->>'vout')::INTEGER AS vout
            FROM jsonb_array_elements(p_utxos) AS item(value)
        ) requested
        GROUP BY txid, vout
        HAVING COUNT(*) > 1
    ) THEN
        RETURN jsonb_build_object('success', false, 'code', 'DUPLICATE_UTXO');
    END IF;

    v_until := NOW() + make_interval(secs => p_lease_seconds);

    -- Acquire transaction-scoped locks in deterministic order to avoid deadlocks.
    FOR v_utxo IN
        SELECT value
        FROM jsonb_array_elements(p_utxos) AS item(value)
        ORDER BY LOWER(TRIM(value->>'txid')), (value->>'vout')::INTEGER
    LOOP
        v_txid := LOWER(TRIM(v_utxo->>'txid'));
        v_vout := (v_utxo->>'vout')::INTEGER;
        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(v_network || ':' || v_txid || ':' || v_vout::TEXT, 0)
        );
    END LOOP;

    -- Expired, not-yet-broadcast reservations can be reclaimed after lock acquisition.
    DELETE FROM public.utxo_reservations
    WHERE reserved_until < NOW()
      AND status = 'RESERVED';

    -- An outpoint reserved by another non-released sweep is never transferable.
    FOR v_utxo IN SELECT value FROM jsonb_array_elements(p_utxos) AS item(value)
    LOOP
        v_txid := LOWER(TRIM(v_utxo->>'txid'));
        v_vout := (v_utxo->>'vout')::INTEGER;

        IF EXISTS (
            SELECT 1
            FROM public.utxo_reservations r
            WHERE LOWER(r.txid) = v_txid
              AND r.vout = v_vout
              AND UPPER(r.network) = v_network
              AND r.sweep_id <> p_sweep_id
              AND r.status <> 'RELEASED'
        ) THEN
            RETURN jsonb_build_object('success', false, 'code', 'UTXO_CONFLICT');
        END IF;
    END LOOP;

    FOR v_utxo IN SELECT value FROM jsonb_array_elements(p_utxos) AS item(value)
    LOOP
        v_txid := LOWER(TRIM(v_utxo->>'txid'));
        v_vout := (v_utxo->>'vout')::INTEGER;

        INSERT INTO public.utxo_reservations AS existing
            (txid, vout, network, sweep_id, status, reserved_until)
        VALUES
            (v_txid, v_vout, v_network, p_sweep_id, 'RESERVED', v_until)
        ON CONFLICT (txid, vout, network)
        DO UPDATE SET
            sweep_id = EXCLUDED.sweep_id,
            status = CASE
                WHEN existing.status = 'RELEASED' THEN 'RESERVED'
                ELSE existing.status
            END,
            reserved_until = CASE
                WHEN existing.status IN ('RELEASED', 'RESERVED') THEN EXCLUDED.reserved_until
                ELSE existing.reserved_until
            END
        WHERE existing.sweep_id = EXCLUDED.sweep_id
           OR existing.status = 'RELEASED';

        v_count := v_count + 1;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'count', v_count);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_utxos_for_sweep(UUID, TEXT, JSONB, INTEGER)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_utxos_for_sweep(UUID, TEXT, JSONB, INTEGER)
TO service_role, postgres;

COMMIT;
