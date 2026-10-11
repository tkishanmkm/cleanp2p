-- Serialize UTXO reservations by outpoint and prevent an ON CONFLICT
-- from transferring an active/broadcast reservation to another sweep.
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
    v_conflict_count INTEGER := 0;
BEGIN
    IF p_sweep_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.sweep_operations s WHERE s.id = p_sweep_id
    ) THEN
        RETURN jsonb_build_object('success', false, 'code', 'SWEEP_NOT_FOUND');
    END IF;

    IF v_network NOT IN ('BTC', 'LTC') THEN
        RETURN jsonb_build_object('success', false, 'code', 'UNSUPPORTED_NETWORK');
    END IF;

    IF p_utxos IS NULL OR jsonb_typeof(p_utxos) <> 'array' OR jsonb_array_length(p_utxos) = 0 THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_UTXOS');
    END IF;

    IF p_lease_seconds IS NULL OR p_lease_seconds < 1 OR p_lease_seconds > 3600 THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_LEASE');
    END IF;

    v_until := NOW() + make_interval(secs => p_lease_seconds);

    -- Serialize contenders for each chain/outpoint before checking or writing.
    -- Transaction-scoped locks are released automatically on commit/rollback.
    FOR v_utxo IN
        SELECT value FROM jsonb_array_elements(p_utxos) AS item(value)
        ORDER BY lower(COALESCE(value->>'txid', '')), COALESCE(value->>'vout', '')
    LOOP
        v_txid := NULLIF(TRIM(v_utxo->>'txid'), '');
        IF v_txid IS NULL OR (v_utxo->>'vout') IS NULL OR (v_utxo->>'vout') !~ '^[0-9]+$' THEN
            RETURN jsonb_build_object('success', false, 'code', 'INVALID_UTXO');
        END IF;
        v_vout := (v_utxo->>'vout')::INTEGER;
        IF v_vout < 0 THEN
            RETURN jsonb_build_object('success', false, 'code', 'INVALID_UTXO');
        END IF;

        PERFORM pg_advisory_xact_lock(hashtextextended(v_network || ':' || lower(v_txid) || ':' || v_vout::TEXT, 0));
    END LOOP;

    -- Expired RESERVED entries are reclaimable only after the lock is held.
    DELETE FROM public.utxo_reservations
    WHERE reserved_until < NOW()
      AND status = 'RESERVED';

    -- No outpoint may be transferred away from another active or reconciled sweep.
    FOR v_utxo IN SELECT value FROM jsonb_array_elements(p_utxos) AS item(value)
    LOOP
        v_txid := TRIM(v_utxo->>'txid');
        v_vout := (v_utxo->>'vout')::INTEGER;

        IF EXISTS (
            SELECT 1
            FROM public.utxo_reservations r
            WHERE r.txid = v_txid
              AND r.vout = v_vout
              AND r.network = v_network
              AND r.sweep_id <> p_sweep_id
              AND r.status <> 'RELEASED'
        ) THEN
            v_conflict_count := v_conflict_count + 1;
        END IF;
    END LOOP;

    IF v_conflict_count > 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'UTXO_CONFLICT',
            'message', 'One or more UTXOs are reserved or reconciled by another sweep'
        );
    END IF;

    FOR v_utxo IN SELECT value FROM jsonb_array_elements(p_utxos) AS item(value)
    LOOP
        v_txid := TRIM(v_utxo->>'txid');
        v_vout := (v_utxo->>'vout')::INTEGER;

        INSERT INTO public.utxo_reservations (txid, vout, network, sweep_id, status, reserved_until)
        VALUES (v_txid, v_vout, v_network, p_sweep_id, 'RESERVED', v_until)
        ON CONFLICT (txid, vout, network)
        DO UPDATE SET
            sweep_id = EXCLUDED.sweep_id,
            status = CASE
                WHEN public.utxo_reservations.status = 'RELEASED' THEN 'RESERVED'
                ELSE public.utxo_reservations.status
            END,
            reserved_until = CASE
                WHEN public.utxo_reservations.status = 'RELEASED'
                  OR public.utxo_reservations.status = 'RESERVED'
                THEN EXCLUDED.reserved_until
                ELSE public.utxo_reservations.reserved_until
            END
        WHERE public.utxo_reservations.sweep_id = EXCLUDED.sweep_id
           OR public.utxo_reservations.status = 'RELEASED';
    END LOOP;

    RETURN jsonb_build_object('success', true, 'count', jsonb_array_length(p_utxos));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_utxos_for_sweep(UUID, TEXT, JSONB, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_utxos_for_sweep(UUID, TEXT, JSONB, INTEGER) TO service_role, postgres;

COMMIT;
