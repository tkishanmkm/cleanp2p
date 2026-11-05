-- Persist canonical EVM withdrawal receipt evidence before financial settlement.
-- Receipt proof is bound to the durable signed payload and the reserved signer/nonce.
-- The worker verifies the live chain; the database enforces that only matching
-- service-recorded finality evidence can settle or revert an EVM withdrawal.
BEGIN;

CREATE TABLE IF NOT EXISTS public.onchain_withdrawal_receipt_proofs (
    withdrawal_id UUID PRIMARY KEY
        REFERENCES public.onchain_withdrawals(id) ON DELETE RESTRICT,
    network TEXT NOT NULL CHECK (network IN ('ERC20', 'BEP20')),
    chain_id INTEGER NOT NULL CHECK (chain_id IN (1, 56)),
    tx_hash TEXT NOT NULL CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
    receipt_status SMALLINT NOT NULL CHECK (receipt_status IN (0, 1)),
    transaction_nonce BIGINT NOT NULL CHECK (transaction_nonce >= 0),
    signer_address TEXT NOT NULL CHECK (signer_address ~ '^0x[0-9a-f]{40}$'),
    block_number BIGINT NOT NULL CHECK (block_number >= 0),
    block_hash TEXT NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
    confirmations INTEGER NOT NULL CHECK (confirmations > 0),
    gas_used NUMERIC(78,0) NOT NULL CHECK (gas_used > 0 AND trunc(gas_used) = gas_used),
    effective_gas_price NUMERIC(78,0) NOT NULL CHECK (effective_gas_price > 0 AND trunc(effective_gas_price) = effective_gas_price),
    actual_gas_amount NUMERIC(36,18) NOT NULL CHECK (actual_gas_amount > 0),
    is_current_canonical BOOLEAN NOT NULL DEFAULT TRUE,
    invalidated_at TIMESTAMPTZ,
    invalidated_reason TEXT CHECK (invalidated_reason IS NULL OR pg_catalog.length(invalidated_reason) <= 1000),
    verified_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    CONSTRAINT uq_onchain_withdrawal_receipt_network_hash UNIQUE (network, tx_hash)
);

ALTER TABLE public.onchain_withdrawal_receipt_proofs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_anon_authenticated_access ON public.onchain_withdrawal_receipt_proofs;
CREATE POLICY deny_anon_authenticated_access
    ON public.onchain_withdrawal_receipt_proofs
    FOR ALL TO anon, authenticated
    USING (false) WITH CHECK (false);

REVOKE ALL PRIVILEGES ON TABLE public.onchain_withdrawal_receipt_proofs
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- A broadcast/ambiguous row intentionally has no active worker lease after the
-- broadcast recorder or ambiguity RPC releases ownership. Only READY_TO_BROADCAST
-- requires a current worker; terminal records must not retain a worker ID.
CREATE OR REPLACE FUNCTION public.guard_onchain_withdrawal_broadcast_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_signed JSONB;
    v_status TEXT := upper(coalesce(NEW.status, ''));
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Durable signed withdrawal payloads cannot be deleted'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.withdrawal_id IS NULL
       OR upper(coalesce(NEW.network, '')) NOT IN ('TRC20', 'ERC20', 'BEP20')
       OR nullif(pg_catalog.btrim(coalesce(NEW.signed_tx, '')), '') IS NULL
       OR v_status NOT IN ('READY_TO_BROADCAST', 'RECOVERY_REQUIRED', 'BROADCASTED', 'CONFIRMED', 'FAILED')
       OR (v_status = 'READY_TO_BROADCAST' AND nullif(pg_catalog.btrim(coalesce(NEW.worker_id, '')), '') IS NULL)
       OR (v_status IN ('CONFIRMED', 'FAILED') AND NEW.worker_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Invalid durable signed withdrawal broadcast record or lease state'
            USING ERRCODE = '22023';
    END IF;

    IF upper(NEW.network) = 'TRC20' THEN
        IF lower(NEW.tx_hash) !~ '^[0-9a-f]{64}$' OR NEW.nonce IS NOT NULL THEN
            RAISE EXCEPTION 'TRON signed withdrawal requires a 64-character txID and no EVM nonce'
                USING ERRCODE = '22023';
        END IF;
        BEGIN
            v_signed := NEW.signed_tx::jsonb;
        EXCEPTION WHEN others THEN
            RAISE EXCEPTION 'Signed TRON withdrawal payload is not valid JSON'
                USING ERRCODE = '22023';
        END;
        IF pg_catalog.jsonb_typeof(v_signed) IS DISTINCT FROM 'object'
           OR lower(coalesce(v_signed->>'txID', '')) IS DISTINCT FROM lower(NEW.tx_hash)
           OR nullif(v_signed->>'raw_data_hex', '') IS NULL
           OR pg_catalog.jsonb_typeof(v_signed->'signature') IS DISTINCT FROM 'array'
           OR pg_catalog.jsonb_array_length(v_signed->'signature') < 1 THEN
            RAISE EXCEPTION 'TRON signed withdrawal integrity check failed'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        IF lower(NEW.tx_hash) !~ '^0x[0-9a-f]{64}$'
           OR NEW.nonce IS NULL OR NEW.nonce < 0
           OR NEW.signed_tx !~* '^0x[0-9a-f]+$'
           OR pg_catalog.length(NEW.signed_tx) % 2 <> 0 THEN
            RAISE EXCEPTION 'EVM signed withdrawal requires raw hex bytes, hash and nonce'
                USING ERRCODE = '22023';
        END IF;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF v_status <> 'READY_TO_BROADCAST' THEN
            RAISE EXCEPTION 'New signed withdrawal records must start READY_TO_BROADCAST'
                USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.withdrawal_id IS DISTINCT FROM OLD.withdrawal_id
       OR upper(NEW.network) IS DISTINCT FROM upper(OLD.network)
       OR NEW.signed_tx IS DISTINCT FROM OLD.signed_tx
       OR lower(NEW.tx_hash) IS DISTINCT FROM lower(OLD.tx_hash)
       OR NEW.nonce IS DISTINCT FROM OLD.nonce
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Signed withdrawal identity, bytes, hash, nonce and creation time are immutable'
            USING ERRCODE = '23505';
    END IF;

    IF NOT (
        OLD.status = NEW.status
        OR (OLD.status = 'READY_TO_BROADCAST' AND NEW.status IN ('BROADCASTED', 'RECOVERY_REQUIRED', 'CONFIRMED', 'FAILED'))
        OR (OLD.status = 'RECOVERY_REQUIRED' AND NEW.status IN ('BROADCASTED', 'CONFIRMED', 'FAILED'))
        OR (OLD.status = 'BROADCASTED' AND NEW.status IN ('RECOVERY_REQUIRED', 'CONFIRMED', 'FAILED'))
    ) THEN
        RAISE EXCEPTION 'Invalid durable withdrawal broadcast transition: % -> %', OLD.status, NEW.status
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_evm_withdrawal_receipt_proof(
    p_withdrawal_id UUID,
    p_network TEXT,
    p_tx_hash TEXT,
    p_receipt_status SMALLINT,
    p_chain_id INTEGER,
    p_transaction_nonce BIGINT,
    p_signer_address TEXT,
    p_block_number BIGINT,
    p_block_hash TEXT,
    p_confirmations INTEGER,
    p_gas_used NUMERIC,
    p_effective_gas_price NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_withdrawal public.onchain_withdrawals%ROWTYPE;
    v_broadcast public.onchain_withdrawal_broadcasts%ROWTYPE;
    v_reservation public.onchain_withdrawal_nonce_reservations%ROWTYPE;
    v_network TEXT := upper(pg_catalog.btrim(coalesce(p_network, '')));
    v_hash TEXT := lower(pg_catalog.btrim(coalesce(p_tx_hash, '')));
    v_block_hash TEXT := lower(pg_catalog.btrim(coalesce(p_block_hash, '')));
    v_signer TEXT := lower(pg_catalog.btrim(coalesce(p_signer_address, '')));
    v_expected_chain_id INTEGER;
    v_required_confirmations INTEGER;
    v_actual_gas_amount NUMERIC(36,18);
    v_rows INTEGER;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Service role required to record EVM withdrawal receipt proofs'
            USING ERRCODE = '42501';
    END IF;

    IF p_withdrawal_id IS NULL
       OR v_network NOT IN ('ERC20', 'BEP20')
       OR v_hash !~ '^0x[0-9a-f]{64}$'
       OR p_receipt_status IS NULL OR p_receipt_status NOT IN (0, 1)
       OR p_transaction_nonce IS NULL OR p_transaction_nonce < 0 OR p_transaction_nonce > 2147483647
       OR v_signer !~ '^0x[0-9a-f]{40}$'
       OR p_block_number IS NULL OR p_block_number < 0
       OR v_block_hash !~ '^0x[0-9a-f]{64}$'
       OR p_confirmations IS NULL
       OR p_gas_used IS NULL OR p_gas_used <= 0 OR pg_catalog.trunc(p_gas_used) <> p_gas_used
       OR p_effective_gas_price IS NULL OR p_effective_gas_price <= 0 OR pg_catalog.trunc(p_effective_gas_price) <> p_effective_gas_price THEN
        RAISE EXCEPTION 'Invalid EVM withdrawal receipt proof payload'
            USING ERRCODE = '22023';
    END IF;

    v_expected_chain_id := CASE WHEN v_network = 'ERC20' THEN 1 ELSE 56 END;
    v_required_confirmations := CASE WHEN v_network = 'ERC20' THEN 12 ELSE 15 END;
    IF p_chain_id IS DISTINCT FROM v_expected_chain_id
       OR p_confirmations < v_required_confirmations THEN
        RAISE EXCEPTION 'EVM withdrawal receipt does not meet the configured chain/finality contract'
            USING ERRCODE = '23514';
    END IF;

    v_actual_gas_amount := (p_gas_used * p_effective_gas_price) / 1000000000000000000::numeric;

    SELECT *
      INTO v_withdrawal
    FROM public.onchain_withdrawals
    WHERE id = p_withdrawal_id
    FOR UPDATE;

    IF NOT FOUND
       OR upper(v_withdrawal.network) IS DISTINCT FROM v_network
       OR lower(coalesce(v_withdrawal.tx_hash, '')) IS DISTINCT FROM v_hash
       OR v_withdrawal.nonce IS DISTINCT FROM p_transaction_nonce
       OR upper(coalesce(v_withdrawal.status, '')) NOT IN (
           'READY_TO_BROADCAST', 'BROADCASTED', 'PROCESSING', 'AMBIGUOUS_BROADCAST'
       ) THEN
        RAISE EXCEPTION 'Receipt proof does not match an active canonical withdrawal identity'
            USING ERRCODE = '23514';
    END IF;

    SELECT *
      INTO v_broadcast
    FROM public.onchain_withdrawal_broadcasts
    WHERE withdrawal_id = p_withdrawal_id
    FOR UPDATE;

    IF NOT FOUND
       OR upper(v_broadcast.network) IS DISTINCT FROM v_network
       OR lower(v_broadcast.tx_hash) IS DISTINCT FROM v_hash
       OR v_broadcast.nonce IS DISTINCT FROM p_transaction_nonce
       OR nullif(pg_catalog.btrim(coalesce(v_broadcast.signed_tx, '')), '') IS NULL
       OR upper(v_broadcast.status) NOT IN ('READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED') THEN
        RAISE EXCEPTION 'Receipt proof does not match the durable signed withdrawal payload'
            USING ERRCODE = '23514';
    END IF;

    SELECT *
      INTO v_reservation
    FROM public.onchain_withdrawal_nonce_reservations
    WHERE withdrawal_id = p_withdrawal_id
    FOR UPDATE;

    IF NOT FOUND
       OR upper(v_reservation.network) IS DISTINCT FROM v_network
       OR lower(v_reservation.wallet_address) IS DISTINCT FROM v_signer
       OR v_reservation.nonce IS DISTINCT FROM p_transaction_nonce
       OR upper(v_reservation.status) NOT IN ('SIGNED', 'BROADCASTED', 'RECOVERY_REQUIRED') THEN
        RAISE EXCEPTION 'Receipt proof signer/nonce does not match the durable hot-wallet nonce reservation'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.onchain_withdrawal_receipt_proofs (
        withdrawal_id, network, chain_id, tx_hash, receipt_status,
        transaction_nonce, signer_address, block_number, block_hash,
        confirmations, gas_used, effective_gas_price, actual_gas_amount,
        is_current_canonical, invalidated_at, invalidated_reason, verified_at, updated_at
    )
    VALUES (
        p_withdrawal_id, v_network, p_chain_id, v_hash, p_receipt_status,
        p_transaction_nonce, v_signer, p_block_number, v_block_hash,
        p_confirmations, p_gas_used, p_effective_gas_price, v_actual_gas_amount,
        TRUE, NULL, NULL, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
    )
    ON CONFLICT (withdrawal_id) DO UPDATE
    SET receipt_status = EXCLUDED.receipt_status,
        block_number = EXCLUDED.block_number,
        block_hash = EXCLUDED.block_hash,
        confirmations = EXCLUDED.confirmations,
        gas_used = EXCLUDED.gas_used,
        effective_gas_price = EXCLUDED.effective_gas_price,
        actual_gas_amount = EXCLUDED.actual_gas_amount,
        is_current_canonical = TRUE,
        invalidated_at = NULL,
        invalidated_reason = NULL,
        verified_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    WHERE public.onchain_withdrawal_receipt_proofs.network = EXCLUDED.network
      AND public.onchain_withdrawal_receipt_proofs.chain_id = EXCLUDED.chain_id
      AND public.onchain_withdrawal_receipt_proofs.tx_hash = EXCLUDED.tx_hash
      AND public.onchain_withdrawal_receipt_proofs.transaction_nonce = EXCLUDED.transaction_nonce
      AND lower(public.onchain_withdrawal_receipt_proofs.signer_address) = EXCLUDED.signer_address;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Receipt proof conflicts with an existing immutable withdrawal transaction identity'
            USING ERRCODE = '23505';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'withdrawal_id', p_withdrawal_id,
        'tx_hash', v_hash,
        'receipt_status', p_receipt_status,
        'actual_gas_amount', v_actual_gas_amount
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.invalidate_evm_withdrawal_receipt_proof(
  p_withdrawal_id UUID, p_network TEXT, p_tx_hash TEXT, p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_w public.onchain_withdrawals%ROWTYPE;
  v_net TEXT := upper(pg_catalog.btrim(coalesce(p_network, '')));
  v_hash TEXT := lower(pg_catalog.btrim(coalesce(p_tx_hash, '')));
  v_rows INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_withdrawal_id IS NULL OR v_net NOT IN ('ERC20', 'BEP20')
     OR v_hash !~ '^0x[0-9a-f]{64}$'
     OR (p_reason IS NOT NULL AND pg_catalog.length(p_reason) > 1000) THEN
    RAISE EXCEPTION 'Invalid EVM receipt invalidation payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_w FROM public.onchain_withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND OR upper(v_w.network) IS DISTINCT FROM v_net
     OR lower(coalesce(v_w.tx_hash, '')) IS DISTINCT FROM v_hash
     OR upper(coalesce(v_w.status, '')) NOT IN ('READY_TO_BROADCAST','BROADCASTED','PROCESSING','AMBIGUOUS_BROADCAST') THEN
    RETURN pg_catalog.jsonb_build_object('success', true, 'invalidated', false);
  END IF;
  UPDATE public.onchain_withdrawal_receipt_proofs
  SET is_current_canonical = FALSE,
      invalidated_at = pg_catalog.clock_timestamp(),
      invalidated_reason = left(coalesce(nullif(pg_catalog.btrim(p_reason), ''), 'Receipt proof no longer canonical'), 1000),
      updated_at = pg_catalog.clock_timestamp()
  WHERE withdrawal_id = p_withdrawal_id AND network = v_net AND tx_hash = v_hash
    AND is_current_canonical IS TRUE;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN pg_catalog.jsonb_build_object('success', true, 'invalidated', v_rows = 1);
END;
$function$;

-- Inject mandatory receipt evidence into both financial settlement procedures.
DO $migration$
DECLARE
    v_definition TEXT;
    v_old TEXT;
    v_new TEXT;
    v_position INTEGER;
BEGIN
    SELECT pg_catalog.pg_get_functiondef(
        'public.complete_onchain_withdrawal(uuid,text,numeric,text)'::regprocedure
    ) INTO v_definition;

    -- Idempotent completion can still backfill ledger fees, so it must require
    -- the same receipt proof as a first-time completion.
    v_old := $old$  IF v_status IN ('completed', 'confirmed') THEN$old$;
    v_new := $new$  IF v_status IN ('completed', 'confirmed') THEN
    IF upper(v_w.network) IN ('ERC20', 'BEP20') AND NOT EXISTS (
      SELECT 1
      FROM public.onchain_withdrawal_receipt_proofs proof
      WHERE proof.withdrawal_id = p_withdrawal_id
        AND proof.network = upper(v_w.network)
        AND proof.tx_hash = v_hash
        AND proof.receipt_status = 1
        AND proof.is_current_canonical IS TRUE
        AND proof.transaction_nonce = v_w.nonce
        AND proof.confirmations >= CASE WHEN upper(v_w.network) = 'ERC20' THEN 12 ELSE 15 END
        AND proof.actual_gas_amount = coalesce(p_actual_gas_amount, 0)
    ) THEN
      RAISE EXCEPTION 'Idempotent EVM completion requires its persisted canonical success receipt proof';
    END IF;$new$;
    v_position := pg_catalog.strpos(v_definition, v_old);
    IF v_position = 0
       OR pg_catalog.strpos(pg_catalog.substr(v_definition, v_position + pg_catalog.length(v_old)), v_old) <> 0 THEN
        RAISE EXCEPTION 'Could not uniquely locate idempotent EVM completion proof guard';
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);

    v_old := $old$  v_fee := coalesce((v_w.metadata->>'fee')::numeric, v_w.fee, 0);
  v_total := v_w.amount + v_fee;$old$;
    v_new := $new$  IF upper(v_w.network) IN ('ERC20', 'BEP20') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.onchain_withdrawal_receipt_proofs proof
      WHERE proof.withdrawal_id = p_withdrawal_id
        AND proof.network = upper(v_w.network)
        AND proof.tx_hash = v_hash
        AND proof.receipt_status = 1
        AND proof.is_current_canonical IS TRUE
        AND proof.transaction_nonce = v_w.nonce
        AND proof.confirmations >= CASE WHEN upper(v_w.network) = 'ERC20' THEN 12 ELSE 15 END
        AND proof.actual_gas_amount = coalesce(p_actual_gas_amount, 0)
    ) OR upper(coalesce(p_gas_asset, '')) IS DISTINCT FROM
        (CASE WHEN upper(v_w.network) = 'ERC20' THEN 'ETH' ELSE 'BNB' END) THEN
      RAISE EXCEPTION 'EVM completion requires a persisted canonical successful receipt proof with matching measured gas';
    END IF;
  END IF;

  v_fee := coalesce((v_w.metadata->>'fee')::numeric, v_w.fee, 0);
  v_total := v_w.amount + v_fee;$new$;

    v_position := pg_catalog.strpos(v_definition, v_old);
    IF v_position = 0
       OR pg_catalog.strpos(
            pg_catalog.substr(v_definition, v_position + pg_catalog.length(v_old)),
            v_old
          ) <> 0 THEN
        RAISE EXCEPTION 'Could not uniquely locate EVM completion receipt-proof insertion point';
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
    EXECUTE v_definition;

    SELECT pg_catalog.pg_get_functiondef(
        'public.process_failed_withdrawal(uuid,text,numeric,text,boolean)'::regprocedure
    ) INTO v_definition;

    -- An idempotent refund call can still backfill gas expense, so it also
    -- requires the latest persisted canonical EVM revert proof.
    v_old := $old$  IF v_status = 'failed' THEN$old$;
    v_new := $new$  IF v_status = 'failed' THEN
    IF upper(v_w.network) IN ('ERC20', 'BEP20')
       AND v_hash IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM public.onchain_withdrawal_receipt_proofs proof
         WHERE proof.withdrawal_id = p_withdrawal_id
           AND proof.network = upper(v_w.network)
           AND proof.tx_hash = v_hash
           AND proof.receipt_status = 0
           AND proof.is_current_canonical IS TRUE
           AND proof.transaction_nonce = v_w.nonce
           AND proof.confirmations >= CASE WHEN upper(v_w.network) = 'ERC20' THEN 12 ELSE 15 END
           AND proof.actual_gas_amount = p_actual_gas_amount
       ) THEN
      RAISE EXCEPTION 'Idempotent EVM refund requires its persisted canonical revert receipt proof';
    END IF;$new$;
    v_position := pg_catalog.strpos(v_definition, v_old);
    IF v_position = 0
       OR pg_catalog.strpos(pg_catalog.substr(v_definition, v_position + pg_catalog.length(v_old)), v_old) <> 0 THEN
        RAISE EXCEPTION 'Could not uniquely locate idempotent EVM refund proof guard';
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);

    v_old := $old$      RAISE EXCEPTION 'Withdrawal has no matching durable signed payload; revert refund is held for manual reconciliation';
    END IF;

    v_gas_asset := upper(pg_catalog.btrim(coalesce(p_gas_asset, '')));$old$;
    v_new := $new$      RAISE EXCEPTION 'Withdrawal has no matching durable signed payload; revert refund is held for manual reconciliation';
    END IF;

    IF upper(v_w.network) IN ('ERC20', 'BEP20') THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.onchain_withdrawal_receipt_proofs proof
        WHERE proof.withdrawal_id = p_withdrawal_id
          AND proof.network = upper(v_w.network)
          AND proof.tx_hash = v_hash
          AND proof.receipt_status = 0
          AND proof.is_current_canonical IS TRUE
          AND proof.transaction_nonce = v_w.nonce
          AND proof.confirmations >= CASE WHEN upper(v_w.network) = 'ERC20' THEN 12 ELSE 15 END
          AND proof.actual_gas_amount = p_actual_gas_amount
      ) THEN
        RAISE EXCEPTION 'EVM revert refund requires a persisted canonical failed receipt proof with matching measured gas';
      END IF;
    END IF;

    v_gas_asset := upper(pg_catalog.btrim(coalesce(p_gas_asset, '')));$new$;

    v_position := pg_catalog.strpos(v_definition, v_old);
    IF v_position = 0
       OR pg_catalog.strpos(
            pg_catalog.substr(v_definition, v_position + pg_catalog.length(v_old)),
            v_old
          ) <> 0 THEN
        RAISE EXCEPTION 'Could not uniquely locate exact EVM refund receipt-proof insertion point';
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
    EXECUTE v_definition;
END;
$migration$;

-- Defense in depth: prevent any other privileged RPC from terminalizing an
-- EVM withdrawal unless its latest persisted receipt proof matches the outcome.
CREATE OR REPLACE FUNCTION public.sync_onchain_withdrawal_broadcast_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_hash TEXT := lower(pg_catalog.btrim(coalesce(NEW.tx_hash, '')));
BEGIN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;

    IF NEW.status IN ('COMPLETED', 'CONFIRMED')
       AND upper(NEW.network) IN ('ERC20', 'BEP20') THEN
        IF NOT EXISTS (
            SELECT 1
            FROM public.onchain_withdrawal_receipt_proofs proof
            WHERE proof.withdrawal_id = NEW.id
              AND proof.network = upper(NEW.network)
              AND proof.tx_hash = v_hash
              AND proof.receipt_status = 1
              AND proof.is_current_canonical IS TRUE
              AND proof.transaction_nonce = NEW.nonce
              AND proof.confirmations >= CASE WHEN upper(NEW.network) = 'ERC20' THEN 12 ELSE 15 END
        ) THEN
            RAISE EXCEPTION 'EVM withdrawal cannot complete without persisted canonical success receipt proof'
                USING ERRCODE = '55000';
        END IF;
    ELSIF NEW.status = 'FAILED'
       AND v_hash <> ''
       AND upper(NEW.network) IN ('ERC20', 'BEP20') THEN
        IF NOT EXISTS (
            SELECT 1
            FROM public.onchain_withdrawal_receipt_proofs proof
            WHERE proof.withdrawal_id = NEW.id
              AND proof.network = upper(NEW.network)
              AND proof.tx_hash = v_hash
              AND proof.receipt_status = 0
              AND proof.is_current_canonical IS TRUE
              AND proof.transaction_nonce = NEW.nonce
              AND proof.confirmations >= CASE WHEN upper(NEW.network) = 'ERC20' THEN 12 ELSE 15 END
        ) THEN
            RAISE EXCEPTION 'EVM withdrawal cannot fail after broadcast without persisted canonical revert receipt proof'
                USING ERRCODE = '55000';
        END IF;
    END IF;

    IF NEW.status IN ('CANCELLED', 'REJECTED') AND v_hash <> ''
       AND upper(NEW.network) IN ('ERC20', 'BEP20') THEN
        RAISE EXCEPTION 'A broadcast EVM withdrawal cannot be cancelled or rejected without nonce reconciliation'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.status IN ('COMPLETED', 'CONFIRMED') THEN
        UPDATE public.onchain_withdrawal_broadcasts
        SET status = 'CONFIRMED', worker_id = NULL, updated_at = pg_catalog.clock_timestamp()
        WHERE withdrawal_id = NEW.id;

        UPDATE public.onchain_withdrawal_nonce_reservations
        SET status = 'CONFIRMED', updated_at = pg_catalog.clock_timestamp()
        WHERE withdrawal_id = NEW.id
          AND status IN ('SIGNED', 'BROADCASTED', 'RECOVERY_REQUIRED');
    ELSIF NEW.status = 'FAILED' AND v_hash <> '' THEN
        UPDATE public.onchain_withdrawal_broadcasts
        SET status = 'FAILED', worker_id = NULL, updated_at = pg_catalog.clock_timestamp()
        WHERE withdrawal_id = NEW.id;

        UPDATE public.onchain_withdrawal_nonce_reservations
        SET status = 'FAILED', updated_at = pg_catalog.clock_timestamp()
        WHERE withdrawal_id = NEW.id
          AND status IN ('SIGNED', 'BROADCASTED', 'RECOVERY_REQUIRED');
    ELSIF NEW.status IN ('FAILED', 'CANCELLED', 'REJECTED')
       AND v_hash = '' THEN
        IF upper(NEW.network) IN ('ERC20', 'BEP20')
           AND EXISTS (
             SELECT 1
             FROM public.onchain_withdrawal_nonce_reservations r
             WHERE r.withdrawal_id = NEW.id
               AND r.status = 'RESERVED'
           ) THEN
            RAISE EXCEPTION 'Unsigned EVM nonce reservation still exists; withdrawal cannot be terminalized or refunded'
                USING ERRCODE = '55000';
        END IF;

        DELETE FROM public.onchain_withdrawal_nonce_reservations
        WHERE withdrawal_id = NEW.id
          AND status = 'RESERVED';
    END IF;

    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_onchain_withdrawal_broadcast_state
    ON public.onchain_withdrawals;
CREATE TRIGGER trg_sync_onchain_withdrawal_broadcast_state
AFTER UPDATE OF status ON public.onchain_withdrawals
FOR EACH ROW
EXECUTE FUNCTION public.sync_onchain_withdrawal_broadcast_state();

REVOKE ALL ON FUNCTION public.record_evm_withdrawal_receipt_proof(uuid,text,text,smallint,integer,bigint,text,bigint,text,integer,numeric,numeric)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.record_evm_withdrawal_receipt_proof(uuid,text,text,smallint,integer,bigint,text,bigint,text,integer,numeric,numeric)
    TO service_role, postgres;

REVOKE ALL ON FUNCTION public.invalidate_evm_withdrawal_receipt_proof(uuid,text,text,text) FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.invalidate_evm_withdrawal_receipt_proof(uuid,text,text,text) TO service_role, postgres;

COMMENT ON TABLE public.onchain_withdrawal_receipt_proofs IS
    'Latest canonical finality evidence for an immutable EVM withdrawal transaction; required before success settlement or revert refund.';

COMMIT;
