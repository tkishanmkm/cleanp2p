-- Fence persisted EVM transaction recovery behind the shared hot-wallet nonce sequence.
-- A signed transaction may be recovered only after every lower nonce for the same
-- hot wallet is terminal, and only if no unresolved nonce incident blocks it.
-- Canonical receipt proofs resolve the corresponding incident atomically.
BEGIN;

DO $dependencies$
BEGIN
    IF to_regclass('public.onchain_withdrawal_nonce_reservations') IS NULL
       OR to_regclass('public.onchain_withdrawal_nonce_incidents') IS NULL
       OR to_regclass('public.evm_gas_funding_nonce_incidents') IS NULL
       OR to_regclass('public.onchain_withdrawal_receipt_proofs') IS NULL THEN
        RAISE EXCEPTION
          'Shared EVM nonce recovery fencing requires the withdrawal reservation, both nonce incident, and receipt proof migrations first';
    END IF;

    IF to_regprocedure('public.claim_pending_withdrawals(integer,text)') IS NULL
       OR to_regprocedure('public.claim_gas_funding_operation(uuid,text,text,numeric,text)') IS NULL
       OR to_regprocedure('public.record_evm_withdrawal_receipt_proof(uuid,text,text,smallint,integer,bigint,text,bigint,text,integer,numeric,numeric)') IS NULL
       OR to_regprocedure('public.record_evm_withdrawal_nonce_incident(uuid,text,text,bigint,text,bigint,bigint,text)') IS NULL
       OR to_regprocedure('public.record_evm_gas_funding_nonce_incident(uuid,text,text,bigint,text,bigint,bigint,text)') IS NULL
       OR to_regprocedure('public.record_evm_gas_funding_receipt(uuid,text,text,smallint,integer,numeric,numeric,bigint,text)') IS NULL THEN
        RAISE EXCEPTION
          'Shared EVM nonce recovery fencing requires the latest worker claim and canonical receipt RPCs first';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='gas_funding_operations'
          AND column_name='funding_wallet_address'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='gas_funding_operations'
          AND column_name='funding_receipt_confirmations'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='gas_funding_operations'
          AND column_name='funding_receipt_block_hash'
    ) THEN
        RAISE EXCEPTION
          'Shared EVM nonce recovery fencing requires wallet-bound gas-funding nonce and canonical receipt columns';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='onchain_withdrawal_nonce_reservations'
          AND column_name='wallet_address'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='onchain_withdrawal_nonce_reservations'
          AND column_name='nonce'
    ) THEN
        RAISE EXCEPTION 'Wallet-bound withdrawal nonce reservation schema is incomplete';
    END IF;
END;
$dependencies$;

-- Internal predicate shared by both recovery-claim RPCs. A same-nonce collision
-- is always blocked; a lower nonce blocks only while its operation is unresolved.
-- Legacy gas-funding rows without a wallet identity are conservatively treated as
-- belonging to this hot wallet because the deployment uses one hot wallet/chain.
CREATE OR REPLACE FUNCTION public.evm_hot_wallet_nonce_recovery_allowed(
    p_network text,
    p_wallet_address text,
    p_nonce bigint,
    p_withdrawal_id uuid DEFAULT NULL,
    p_gas_funding_operation_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_network text := upper(pg_catalog.btrim(coalesce(p_network, '')));
    v_wallet text := lower(pg_catalog.btrim(coalesce(p_wallet_address, '')));
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Service role required for EVM nonce recovery eligibility'
            USING ERRCODE = '42501';
    END IF;

    IF v_network NOT IN ('ERC20', 'BEP20')
       OR v_wallet !~ '^0x[0-9a-f]{40}$'
       OR p_nonce IS NULL OR p_nonce < 0
       OR (p_withdrawal_id IS NOT NULL AND p_gas_funding_operation_id IS NOT NULL) THEN
        RETURN FALSE;
    END IF;

    -- A withdrawal with an unresolved incident is held until its own exact
    -- canonical receipt proof is persisted by record_evm_withdrawal_receipt_proof.
    IF p_withdrawal_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.onchain_withdrawal_nonce_incidents incident
        WHERE incident.withdrawal_id = p_withdrawal_id
          AND incident.status = 'OPEN'
    ) THEN
        RETURN FALSE;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.onchain_withdrawal_nonce_reservations prior
        WHERE prior.withdrawal_id IS DISTINCT FROM p_withdrawal_id
          AND upper(prior.network) = v_network
          AND lower(prior.wallet_address) = v_wallet
          AND prior.nonce <= p_nonce
          AND (
              prior.nonce = p_nonce
              OR upper(coalesce(prior.status, '')) NOT IN ('CONFIRMED', 'FAILED', 'RELEASED')
          )
    ) THEN
        RETURN FALSE;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.gas_funding_operations prior
        WHERE prior.id IS DISTINCT FROM p_gas_funding_operation_id
          AND upper(prior.network) = v_network
          AND prior.nonce IS NOT NULL
          AND prior.nonce <= p_nonce
          AND (
              prior.funding_wallet_address IS NULL
              OR lower(prior.funding_wallet_address) = v_wallet
          )
          AND (
              prior.nonce = p_nonce
              OR upper(coalesce(prior.status, '')) NOT IN ('CONFIRMED', 'FAILED')
          )
    ) THEN
        RETURN FALSE;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.onchain_withdrawal_nonce_incidents incident
        WHERE incident.withdrawal_id IS DISTINCT FROM p_withdrawal_id
          AND incident.network = v_network
          AND lower(incident.wallet_address) = v_wallet
          AND incident.expected_nonce <= p_nonce
          AND incident.status = 'OPEN'
    ) THEN
        RETURN FALSE;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.evm_gas_funding_nonce_incidents incident
        WHERE incident.gas_funding_operation_id IS DISTINCT FROM p_gas_funding_operation_id
          AND incident.network = v_network
          AND lower(incident.wallet_address) = v_wallet
          AND incident.expected_nonce <= p_nonce
          AND incident.status = 'OPEN'
    ) THEN
        RETURN FALSE;
    END IF;

    -- The current gas-funding operation is intentionally not blocked by its own
    -- incident: its worker must be able to re-check the exact persisted receipt.
    RETURN TRUE;
END;
$function$;

REVOKE ALL ON FUNCTION public.evm_hot_wallet_nonce_recovery_allowed(text,text,bigint,uuid,uuid)
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.evm_hot_wallet_nonce_recovery_allowed(text,text,bigint,uuid,uuid)
    TO postgres;

COMMENT ON FUNCTION public.evm_hot_wallet_nonce_recovery_allowed(text,text,bigint,uuid,uuid) IS
    'Internal fail-closed gate for exact-byte EVM recovery; rejects same-nonce collisions, unresolved lower nonces, and open earlier nonce incidents.';

-- Claiming a persisted withdrawal payload is the hand-off point before exact-byte
-- rebroadcast. Require the row's own durable reservation and sequence eligibility.
DO $patch_withdrawal_claim$
DECLARE
    v_definition text;
    v_marker text := $marker$AND nullif(btrim(coalesce(b.signed_tx, '')), '') IS NOT NULL$marker$;
    v_insert text := $insert$
            AND (
                upper(w.network) NOT IN ('ERC20', 'BEP20')
                OR EXISTS (
                    SELECT 1
                    FROM public.onchain_withdrawal_nonce_reservations own
                    WHERE own.withdrawal_id = w.id
                      AND upper(own.network) = upper(w.network)
                      AND own.nonce = w.nonce
                      AND upper(own.status) IN ('SIGNED', 'BROADCASTED', 'RECOVERY_REQUIRED')
                      AND public.evm_hot_wallet_nonce_recovery_allowed(
                          upper(w.network), own.wallet_address, own.nonce, w.id, NULL
                      )
                )
            )
$insert$;
    v_position integer;
BEGIN
    SELECT pg_catalog.pg_get_functiondef(
        'public.claim_pending_withdrawals(integer,text)'::regprocedure
    ) INTO v_definition;

    v_position := pg_catalog.strpos(v_definition, v_marker);
    IF v_position = 0
       OR pg_catalog.strpos(
            pg_catalog.substr(v_definition, v_position + pg_catalog.length(v_marker)),
            v_marker
          ) <> 0 THEN
        RAISE EXCEPTION 'Could not uniquely locate the durable signed-withdrawal recovery candidate';
    END IF;

    v_definition := pg_catalog.replace(v_definition, v_marker, v_marker || v_insert);
    EXECUTE v_definition;
END;
$patch_withdrawal_claim$;

-- Claiming persisted gas-funding bytes also requires the shared nonce sequence.
-- Missing nonce/wallet identity fails closed and remains an operator-reconciliation case.
DO $patch_gas_claim$
DECLARE
    v_definition text;
    v_marker text := $marker$IF v_gas.status IN ('READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED') THEN$marker$;
    v_insert text := $insert$
        IF v_network IN ('ERC20', 'BEP20') THEN
            IF v_gas.nonce IS NULL
               OR nullif(pg_catalog.btrim(coalesce(v_gas.funding_wallet_address, '')), '') IS NULL
               OR NOT public.evm_hot_wallet_nonce_recovery_allowed(
                   v_network, v_gas.funding_wallet_address, v_gas.nonce, NULL, v_gas.id
               ) THEN
                RAISE EXCEPTION 'EVM gas-funding exact-byte recovery is blocked by an unresolved or conflicting earlier hot-wallet nonce; manual reconciliation is required'
                    USING ERRCODE = '55P03';
            END IF;
        END IF;
$insert$;
    v_position integer;
BEGIN
    SELECT pg_catalog.pg_get_functiondef(
        'public.claim_gas_funding_operation(uuid,text,text,numeric,text)'::regprocedure
    ) INTO v_definition;

    v_position := pg_catalog.strpos(v_definition, v_marker);
    IF v_position = 0
       OR pg_catalog.strpos(
            pg_catalog.substr(v_definition, v_position + pg_catalog.length(v_marker)),
            v_marker
          ) <> 0 THEN
        RAISE EXCEPTION 'Could not uniquely locate the persisted gas-funding transaction recovery branch';
    END IF;

    v_definition := pg_catalog.replace(v_definition, v_marker, v_marker || v_insert);
    EXECUTE v_definition;
END;
$patch_gas_claim$;

-- A final canonical receipt proof resolves only the matching withdrawal incident.
-- This update is in the same transaction as the immutable proof upsert, so an
-- incident can never be resolved by an unpersisted or mismatched chain observation.
DO $patch_withdrawal_receipt$
DECLARE
    v_definition text;
    v_marker text := $marker$
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Receipt proof conflicts with an existing immutable withdrawal transaction identity'
            USING ERRCODE = '23505';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
$marker$;
    v_insert text := $insert$
    UPDATE public.onchain_withdrawal_nonce_incidents
    SET status = 'RESOLVED',
        resolution_type = CASE
            WHEN p_receipt_status = 1 THEN 'CANONICAL_SUCCESS_RECEIPT'
            ELSE 'CANONICAL_REVERT_RECEIPT'
        END,
        resolution_reference = v_hash || ':' || v_block_hash || ':' || p_block_number::text,
        resolved_at = pg_catalog.clock_timestamp(),
        resolved_by = 'canonical_receipt_proof',
        metadata = metadata || pg_catalog.jsonb_build_object(
            'receipt_status', p_receipt_status,
            'receipt_block_number', p_block_number,
            'receipt_block_hash', v_block_hash,
            'receipt_confirmations', p_confirmations
        ),
        updated_at = pg_catalog.clock_timestamp()
    WHERE withdrawal_id = p_withdrawal_id
      AND network = v_network
      AND wallet_address = v_signer
      AND expected_nonce = p_transaction_nonce
      AND expected_tx_hash = v_hash
      AND status = 'OPEN';

$insert$;
    v_position integer;
BEGIN
    SELECT pg_catalog.pg_get_functiondef(
        'public.record_evm_withdrawal_receipt_proof(uuid,text,text,smallint,integer,bigint,text,bigint,text,integer,numeric,numeric)'::regprocedure
    ) INTO v_definition;

    v_position := pg_catalog.strpos(v_definition, v_marker);
    IF v_position = 0
       OR pg_catalog.strpos(
            pg_catalog.substr(v_definition, v_position + pg_catalog.length(v_marker)),
            v_marker
          ) <> 0 THEN
        RAISE EXCEPTION 'Could not uniquely locate the persisted withdrawal receipt-proof completion point';
    END IF;

    v_definition := pg_catalog.replace(v_definition, v_marker, pg_catalog.replace(v_marker,
        '    RETURN pg_catalog.jsonb_build_object(', v_insert || '    RETURN pg_catalog.jsonb_build_object('));
    EXECUTE v_definition;
END;
$patch_withdrawal_receipt$;

-- A canonical gas-funding receipt resolves only the incident for the exact
-- persisted operation/wallet/nonce/hash. Reorg recovery marks only operation
-- status and does not touch receipt columns, so it cannot trigger this resolver.
CREATE OR REPLACE FUNCTION public.resolve_evm_gas_funding_nonce_incident_from_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_network text := upper(coalesce(NEW.network, ''));
    v_required_confirmations integer;
BEGIN
    IF v_network NOT IN ('ERC20', 'BEP20') THEN
        RETURN NEW;
    END IF;

    v_required_confirmations := CASE WHEN v_network = 'ERC20' THEN 12 ELSE 15 END;

    IF NEW.nonce IS NULL OR NEW.nonce < 0
       OR NEW.funding_wallet_address IS NULL
       OR lower(NEW.funding_wallet_address) !~ '^0x[0-9a-f]{40}$'
       OR lower(coalesce(NEW.tx_hash, '')) !~ '^0x[0-9a-f]{64}$'
       OR NEW.funding_receipt_status IS NULL
       OR NEW.funding_receipt_status NOT IN (0, 1)
       OR NEW.funding_receipt_confirmations IS NULL
       OR NEW.funding_receipt_confirmations < v_required_confirmations
       OR NEW.funding_receipt_block_number IS NULL
       OR NEW.funding_receipt_block_number < 0
       OR lower(coalesce(NEW.funding_receipt_block_hash, '')) !~ '^0x[0-9a-f]{64}$'
       OR NEW.actual_funding_tx_gas_used IS NULL
       OR NEW.actual_funding_tx_gas_used <= 0
       OR NEW.actual_funding_tx_effective_gas_price IS NULL
       OR NEW.actual_funding_tx_effective_gas_price <= 0
       OR NEW.actual_funding_tx_fee IS NULL
       OR NEW.actual_funding_tx_fee <= 0
       OR (NEW.funding_receipt_status = 1 AND upper(NEW.status) <> 'CONFIRMED')
       OR (NEW.funding_receipt_status = 0 AND upper(NEW.status) NOT IN ('RECOVERY_REQUIRED', 'FAILED')) THEN
        RETURN NEW;
    END IF;

    UPDATE public.evm_gas_funding_nonce_incidents
    SET status = 'RESOLVED',
        resolution_type = CASE
            WHEN NEW.funding_receipt_status = 1 THEN 'CANONICAL_SUCCESS_RECEIPT'
            ELSE 'CANONICAL_REVERT_RECEIPT'
        END,
        resolution_reference = lower(NEW.tx_hash) || ':' ||
            NEW.funding_receipt_block_number::text || ':' ||
            lower(NEW.funding_receipt_block_hash),
        resolved_at = pg_catalog.clock_timestamp(),
        resolved_by = 'canonical_receipt_proof',
        metadata = metadata || pg_catalog.jsonb_build_object(
            'receipt_status', NEW.funding_receipt_status,
            'receipt_block_number', NEW.funding_receipt_block_number,
            'receipt_block_hash', lower(NEW.funding_receipt_block_hash),
            'receipt_confirmations', NEW.funding_receipt_confirmations
        ),
        updated_at = pg_catalog.clock_timestamp()
    WHERE gas_funding_operation_id = NEW.id
      AND network = v_network
      AND lower(wallet_address) = lower(NEW.funding_wallet_address)
      AND expected_nonce = NEW.nonce
      AND expected_tx_hash = lower(NEW.tx_hash)
      AND status = 'OPEN';

    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_evm_gas_funding_nonce_incident_from_receipt()
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

DROP TRIGGER IF EXISTS trg_resolve_evm_gas_funding_nonce_incident_from_receipt
    ON public.gas_funding_operations;
CREATE TRIGGER trg_resolve_evm_gas_funding_nonce_incident_from_receipt
AFTER UPDATE OF
    funding_receipt_status,
    actual_funding_tx_gas_used,
    actual_funding_tx_effective_gas_price,
    actual_funding_tx_fee,
    funding_receipt_block_number,
    funding_receipt_block_hash,
    funding_receipt_confirmations
ON public.gas_funding_operations
FOR EACH ROW
EXECUTE FUNCTION public.resolve_evm_gas_funding_nonce_incident_from_receipt();

-- Allow an incident to reopen only for the same immutable withdrawal operation,
-- signer, nonce and hash after a later canonicality-loss observation.
DO $reopen_withdrawal_incident$
DECLARE
    v_definition text;
    v_marker text;
    v_position integer;
BEGIN
    SELECT pg_catalog.pg_get_functiondef(
        'public.record_evm_withdrawal_nonce_incident(uuid,text,text,bigint,text,bigint,bigint,text)'::regprocedure
    ) INTO v_definition;

    v_marker := $marker$SET incident_type = EXCLUDED.incident_type,$marker$;
    v_position := pg_catalog.strpos(v_definition, v_marker);
    IF v_position = 0
       OR pg_catalog.strpos(pg_catalog.substr(v_definition, v_position + pg_catalog.length(v_marker)), v_marker) <> 0 THEN
        RAISE EXCEPTION 'Could not uniquely locate withdrawal nonce incident upsert fields';
    END IF;
    v_definition := pg_catalog.replace(
        v_definition,
        v_marker,
        $replacement$SET status = 'OPEN',
        resolution_type = NULL,
        resolution_reference = NULL,
        resolved_at = NULL,
        resolved_by = NULL,
        incident_type = EXCLUDED.incident_type,$replacement$
    );

    v_marker := $marker$public.onchain_withdrawal_nonce_incidents.status = 'OPEN'$marker$;
    v_position := pg_catalog.strpos(v_definition, v_marker);
    IF v_position = 0
       OR pg_catalog.strpos(pg_catalog.substr(v_definition, v_position + pg_catalog.length(v_marker)), v_marker) <> 0 THEN
        RAISE EXCEPTION 'Could not uniquely locate withdrawal nonce incident reopen predicate';
    END IF;
    v_definition := pg_catalog.replace(
        v_definition,
        v_marker,
        $replacement$(public.onchain_withdrawal_nonce_incidents.status IN ('OPEN', 'RESOLVED'))$replacement$
    );

    EXECUTE v_definition;
END;
$reopen_withdrawal_incident$;

DO $reopen_gas_incident$
DECLARE
    v_definition text;
    v_marker text;
    v_position integer;
BEGIN
    SELECT pg_catalog.pg_get_functiondef(
        'public.record_evm_gas_funding_nonce_incident(uuid,text,text,bigint,text,bigint,bigint,text)'::regprocedure
    ) INTO v_definition;

    v_marker := $marker$SET incident_type = EXCLUDED.incident_type,$marker$;
    v_position := pg_catalog.strpos(v_definition, v_marker);
    IF v_position = 0
       OR pg_catalog.strpos(pg_catalog.substr(v_definition, v_position + pg_catalog.length(v_marker)), v_marker) <> 0 THEN
        RAISE EXCEPTION 'Could not uniquely locate gas-funding nonce incident upsert fields';
    END IF;
    v_definition := pg_catalog.replace(
        v_definition,
        v_marker,
        $replacement$SET status = 'OPEN',
        resolution_type = NULL,
        resolution_reference = NULL,
        resolved_at = NULL,
        resolved_by = NULL,
        incident_type = EXCLUDED.incident_type,$replacement$
    );

    v_marker := $marker$public.evm_gas_funding_nonce_incidents.status = 'OPEN'$marker$;
    v_position := pg_catalog.strpos(v_definition, v_marker);
    IF v_position = 0
       OR pg_catalog.strpos(pg_catalog.substr(v_definition, v_position + pg_catalog.length(v_marker)), v_marker) <> 0 THEN
        RAISE EXCEPTION 'Could not uniquely locate gas-funding nonce incident reopen predicate';
    END IF;
    v_definition := pg_catalog.replace(
        v_definition,
        v_marker,
        $replacement$(public.evm_gas_funding_nonce_incidents.status IN ('OPEN', 'RESOLVED'))$replacement$
    );

    EXECUTE v_definition;
END;
$reopen_gas_incident$;

NOTIFY pgrst, 'reload schema';

COMMIT;
