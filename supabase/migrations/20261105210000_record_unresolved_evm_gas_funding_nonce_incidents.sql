-- Observe missing EVM gas-funding transactions whose shared hot-wallet nonce
-- has advanced. This is an incident-only record: it never settles, retries with
-- a new nonce, refunds funds, or releases the existing nonce reservation.
BEGIN;

CREATE TABLE IF NOT EXISTS public.evm_gas_funding_nonce_incidents (
    gas_funding_operation_id UUID PRIMARY KEY
        REFERENCES public.gas_funding_operations(id) ON DELETE RESTRICT,
    sweep_id UUID NOT NULL
        REFERENCES public.sweep_operations(id) ON DELETE RESTRICT,
    network TEXT NOT NULL CHECK (network IN ('ERC20', 'BEP20')),
    chain_id INTEGER NOT NULL CHECK (chain_id IN (1, 56)),
    wallet_address TEXT NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
    expected_nonce BIGINT NOT NULL CHECK (expected_nonce >= 0),
    expected_tx_hash TEXT NOT NULL CHECK (expected_tx_hash ~ '^0x[0-9a-f]{64}$'),
    incident_type TEXT NOT NULL
        CHECK (incident_type IN ('PENDING_NONCE_ADVANCED', 'CANONICAL_NONCE_ADVANCED')),
    observed_latest_nonce BIGINT NOT NULL CHECK (observed_latest_nonce >= 0),
    observed_pending_nonce BIGINT NOT NULL CHECK (observed_pending_nonce >= 0),
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    occurrence_count BIGINT NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
    resolution_type TEXT,
    resolution_reference TEXT,
    resolved_at TIMESTAMPTZ,
    resolved_by TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (pg_catalog.jsonb_typeof(metadata) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    CONSTRAINT ck_evm_gas_nonce_incident_resolution CHECK (
        (status = 'OPEN' AND resolved_at IS NULL AND resolved_by IS NULL
            AND resolution_type IS NULL AND resolution_reference IS NULL)
        OR
        (status = 'RESOLVED' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL
            AND resolution_type IS NOT NULL AND resolution_reference IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_evm_gas_nonce_incidents_open
    ON public.evm_gas_funding_nonce_incidents (network, wallet_address, expected_nonce)
    WHERE status = 'OPEN';

ALTER TABLE public.evm_gas_funding_nonce_incidents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_anon_authenticated_access
    ON public.evm_gas_funding_nonce_incidents;
CREATE POLICY deny_anon_authenticated_access
    ON public.evm_gas_funding_nonce_incidents
    FOR ALL TO anon, authenticated
    USING (false) WITH CHECK (false);
REVOKE ALL PRIVILEGES ON TABLE public.evm_gas_funding_nonce_incidents
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION public.record_evm_gas_funding_nonce_incident(
    p_sweep_id UUID,
    p_network TEXT,
    p_wallet_address TEXT,
    p_expected_nonce BIGINT,
    p_expected_tx_hash TEXT,
    p_observed_latest_nonce BIGINT,
    p_observed_pending_nonce BIGINT,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_sweep public.sweep_operations%ROWTYPE;
    v_gas public.gas_funding_operations%ROWTYPE;
    v_network TEXT := upper(pg_catalog.btrim(coalesce(p_network, '')));
    v_wallet TEXT := lower(pg_catalog.btrim(coalesce(p_wallet_address, '')));
    v_hash TEXT := lower(pg_catalog.btrim(coalesce(p_expected_tx_hash, '')));
    v_chain_id INTEGER;
    v_incident_type TEXT;
    v_result public.evm_gas_funding_nonce_incidents%ROWTYPE;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Service role required to record EVM gas-funding nonce incidents'
            USING ERRCODE = '42501';
    END IF;

    IF p_sweep_id IS NULL
       OR v_network NOT IN ('ERC20', 'BEP20')
       OR v_wallet !~ '^0x[0-9a-f]{40}$'
       OR p_expected_nonce IS NULL OR p_expected_nonce < 0
       OR v_hash !~ '^0x[0-9a-f]{64}$'
       OR p_observed_latest_nonce IS NULL OR p_observed_latest_nonce < 0
       OR p_observed_pending_nonce IS NULL OR p_observed_pending_nonce < 0
       OR (p_reason IS NOT NULL AND pg_catalog.length(p_reason) > 1000) THEN
        RAISE EXCEPTION 'Invalid EVM gas-funding nonce incident observation'
            USING ERRCODE = '22023';
    END IF;

    IF p_observed_latest_nonce <= p_expected_nonce
       AND p_observed_pending_nonce <= p_expected_nonce THEN
        RAISE EXCEPTION 'Observed hot-wallet nonce has not advanced beyond the expected gas-funding nonce'
            USING ERRCODE = '23514';
    END IF;

    v_chain_id := CASE WHEN v_network = 'ERC20' THEN 1 ELSE 56 END;
    v_incident_type := CASE
        WHEN p_observed_latest_nonce > p_expected_nonce
            THEN 'CANONICAL_NONCE_ADVANCED'
        ELSE 'PENDING_NONCE_ADVANCED'
    END;

    -- Keep the same parent-sweep -> child-operation lock order used by the
    -- allocation and claim RPCs to avoid introducing a lock-order deadlock.
    SELECT *
      INTO v_sweep
    FROM public.sweep_operations
    WHERE id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND
       OR upper(coalesce(v_sweep.network, '')) NOT IN (v_network, CASE WHEN v_network = 'ERC20' THEN 'ETH' ELSE 'BSC' END,
                                                               CASE WHEN v_network = 'ERC20' THEN 'ETHEREUM' ELSE 'BINANCE' END)
       OR upper(coalesce(v_sweep.status, '')) NOT IN ('GAS_FUNDING', 'GAS_FUNDED') THEN
        RAISE EXCEPTION 'Nonce incident does not match an active/recoverable EVM sweep'
            USING ERRCODE = '23514';
    END IF;

    SELECT *
      INTO v_gas
    FROM public.gas_funding_operations
    WHERE sweep_id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND
       OR upper(v_gas.network) IS DISTINCT FROM v_network
       OR v_gas.nonce IS DISTINCT FROM p_expected_nonce
       OR lower(coalesce(v_gas.tx_hash, '')) IS DISTINCT FROM v_hash
       OR nullif(pg_catalog.btrim(coalesce(v_gas.signed_tx_hex, '')), '') IS NULL
       OR (v_gas.funding_wallet_address IS NOT NULL
           AND lower(v_gas.funding_wallet_address) IS DISTINCT FROM v_wallet)
       OR upper(coalesce(v_gas.status, '')) NOT IN (
            'READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED', 'CONFIRMED'
       ) THEN
        RAISE EXCEPTION 'Nonce incident requires the exact durable gas-funding transaction and matching hot-wallet nonce reservation'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.evm_gas_funding_nonce_incidents (
        gas_funding_operation_id, sweep_id, network, chain_id, wallet_address,
        expected_nonce, expected_tx_hash, incident_type,
        observed_latest_nonce, observed_pending_nonce, metadata, updated_at
    )
    VALUES (
        v_gas.id, p_sweep_id, v_network, v_chain_id, v_wallet,
        p_expected_nonce, v_hash, v_incident_type,
        p_observed_latest_nonce, p_observed_pending_nonce,
        pg_catalog.jsonb_build_object(
            'expected_transaction_lookup', 'NOT_FOUND',
            'observation_reason', left(
                coalesce(p_reason, 'Expected gas-funding transaction missing while shared hot-wallet nonce advanced'),
                1000
            )
        ),
        pg_catalog.clock_timestamp()
    )
    ON CONFLICT (gas_funding_operation_id) DO UPDATE
    SET incident_type = EXCLUDED.incident_type,
        observed_latest_nonce = greatest(
            public.evm_gas_funding_nonce_incidents.observed_latest_nonce,
            EXCLUDED.observed_latest_nonce
        ),
        observed_pending_nonce = greatest(
            public.evm_gas_funding_nonce_incidents.observed_pending_nonce,
            EXCLUDED.observed_pending_nonce
        ),
        last_seen_at = pg_catalog.clock_timestamp(),
        occurrence_count = public.evm_gas_funding_nonce_incidents.occurrence_count + 1,
        metadata = public.evm_gas_funding_nonce_incidents.metadata || EXCLUDED.metadata,
        updated_at = pg_catalog.clock_timestamp()
    WHERE public.evm_gas_funding_nonce_incidents.status = 'OPEN'
      AND public.evm_gas_funding_nonce_incidents.network = EXCLUDED.network
      AND public.evm_gas_funding_nonce_incidents.wallet_address = EXCLUDED.wallet_address
      AND public.evm_gas_funding_nonce_incidents.expected_nonce = EXCLUDED.expected_nonce
      AND public.evm_gas_funding_nonce_incidents.expected_tx_hash = EXCLUDED.expected_tx_hash
    RETURNING * INTO v_result;

    IF NOT FOUND THEN
        SELECT *
          INTO v_result
        FROM public.evm_gas_funding_nonce_incidents
        WHERE gas_funding_operation_id = v_gas.id;

        IF NOT FOUND
           OR v_result.status <> 'OPEN'
           OR v_result.network <> v_network
           OR v_result.wallet_address <> v_wallet
           OR v_result.expected_nonce <> p_expected_nonce
           OR v_result.expected_tx_hash <> v_hash THEN
            RAISE EXCEPTION 'A conflicting or already-resolved gas-funding nonce incident exists; manual review is required'
                USING ERRCODE = '23505';
        END IF;
    END IF;

    -- Observation only. Funds, parent sweep, signed transaction, and nonce stay locked.
    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'status', v_result.status,
        'incident_type', v_result.incident_type,
        'occurrence_count', v_result.occurrence_count,
        'sweep_id', p_sweep_id,
        'gas_funding_operation_id', v_gas.id,
        'expected_nonce', p_expected_nonce,
        'observed_latest_nonce', v_result.observed_latest_nonce,
        'observed_pending_nonce', v_result.observed_pending_nonce
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_evm_gas_funding_nonce_incident(uuid,text,text,bigint,text,bigint,bigint,text)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.record_evm_gas_funding_nonce_incident(uuid,text,text,bigint,text,bigint,bigint,text)
    TO service_role, postgres;

COMMENT ON TABLE public.evm_gas_funding_nonce_incidents IS
    'Service-only observations of missing durable EVM gas-funding transactions after the shared hot-wallet nonce advanced; never releases or settles the operation.';

COMMIT;
