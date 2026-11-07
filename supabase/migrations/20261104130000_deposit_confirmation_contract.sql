-- Paxones canonical multi-chain pending-deposit and confirmation contract.
-- The leased wrapper performs the only scanner credit path and persists the
-- independently verified block inclusion identity in the same DB transaction.
-- Run only after reconciling the local migration history with paxonesflows.

BEGIN;

ALTER TABLE public.onchain_deposits
  ADD COLUMN IF NOT EXISTS confirmation_worker_id text,
  ADD COLUMN IF NOT EXISTS confirmation_lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS block_number bigint,
  ADD COLUMN IF NOT EXISTS block_hash text;

ALTER TABLE public.deposits
  ADD COLUMN IF NOT EXISTS block_hash text;

-- Persist the inclusion identity that authorized each financial credit. Legacy
-- rows remain NULL and are intentionally not assigned a guessed block hash.
DO $block_identity$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.onchain_deposits'::regclass
      AND conname = 'onchain_deposit_block_identity_check'
  ) THEN
    ALTER TABLE public.onchain_deposits
      ADD CONSTRAINT onchain_deposit_block_identity_check
      CHECK (
        (block_number IS NULL AND block_hash IS NULL)
        OR (
          block_number IS NOT NULL AND block_number > 0
          AND block_hash IS NOT NULL
          AND (
            (upper(network) IN ('ETH', 'ERC20', 'BEP20') AND block_hash ~ '^0x[0-9a-fA-F]{64}$')
            OR
            (upper(network) IN ('TRC20', 'BTC', 'LTC') AND block_hash ~ '^[0-9a-fA-F]{64}$')
          )
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.deposits'::regclass
      AND conname = 'deposits_block_hash_format_check'
  ) THEN
    ALTER TABLE public.deposits
      ADD CONSTRAINT deposits_block_hash_format_check
      CHECK (
        block_hash IS NULL
        OR (
          (upper(chain) IN ('ETH', 'ERC20', 'BEP20') AND block_hash ~ '^0x[0-9a-fA-F]{64}$')
          OR
          (upper(chain) IN ('TRC20', 'BTC', 'LTC') AND block_hash ~ '^[0-9a-fA-F]{64}$')
        )
      );
  END IF;
END;
$block_identity$;

-- The worker identity and expiry are one indivisible lease state. Reject blank
-- owner tokens and partial leases so claims cannot become permanently ambiguous.
DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.onchain_deposits'::regclass
      AND conname = 'onchain_deposit_confirmation_lease_state_check'
  ) THEN
    ALTER TABLE public.onchain_deposits
      ADD CONSTRAINT onchain_deposit_confirmation_lease_state_check
      CHECK (
        (confirmation_worker_id IS NULL AND confirmation_lease_expires_at IS NULL)
        OR
        (
          confirmation_worker_id IS NOT NULL
          AND pg_catalog.btrim(confirmation_worker_id) <> ''
          AND confirmation_lease_expires_at IS NOT NULL
        )
      );
  END IF;
END;
$constraint$;

CREATE INDEX IF NOT EXISTS idx_onchain_deposits_confirmation_claim
  ON public.onchain_deposits (status, confirmation_lease_expires_at, created_at, id)
  WHERE status = 'PENDING';

-- Supports the follow-up integrity monitor without scanning unconfirmed records.
CREATE INDEX IF NOT EXISTS idx_onchain_deposits_confirmed_block_identity
  ON public.onchain_deposits (updated_at, id)
  WHERE status = 'CONFIRMED' AND block_hash IS NOT NULL;

-- Scanner wrapper: insert/update the pending record through the canonical
-- identity-checking RPC. Scanners pass zero confirmations; they never credit.
CREATE OR REPLACE FUNCTION public.register_pending_deposit(
  p_destination_address text,
  p_asset_symbol text,
  p_network_code text,
  p_amount numeric,
  p_tx_hash text,
  p_output_index integer,
  p_block_number bigint,
  p_from_address text,
  p_token_contract text,
  p_confirmations integer,
  p_provider text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to register pending deposits'
      USING ERRCODE = '42501';
  END IF;

  IF p_confirmations IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Deposit scanners may only register zero-confirmation pending candidates'
      USING ERRCODE = '22023';
  END IF;

  RETURN public.process_deposit_atomic(
    p_destination_address,
    p_asset_symbol,
    p_network_code,
    p_amount,
    p_tx_hash,
    p_output_index,
    p_block_number,
    p_from_address,
    p_token_contract,
    0,
    p_provider
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.register_pending_deposit(text, text, text, numeric, text, integer, bigint, text, text, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_pending_deposit(text, text, text, numeric, text, integer, bigint, text, text, integer, text)
  TO service_role, postgres;

-- Claim a bounded set of pending candidates. SKIP LOCKED plus an expiring
-- worker token prevents two workers from processing one on-chain output at once.
CREATE OR REPLACE FUNCTION public.claim_pending_deposit_confirmations(
  p_owner_token text,
  p_limit integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 300
)
RETURNS SETOF public.onchain_deposits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_limit integer := least(100, greatest(1, coalesce(p_limit, 10)));
  v_lease_seconds integer := least(900, greatest(30, coalesce(p_lease_seconds, 300)));
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to claim deposit confirmations'
      USING ERRCODE = '42501';
  END IF;

  IF p_owner_token IS NULL OR btrim(p_owner_token) = '' OR length(p_owner_token) > 128 THEN
    RAISE EXCEPTION 'A valid deposit confirmation worker token is required'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT d.id
    FROM public.onchain_deposits AS d
    WHERE d.status = 'PENDING'
      AND (
        d.confirmation_lease_expires_at IS NULL
        OR d.confirmation_lease_expires_at <= pg_catalog.clock_timestamp()
      )
    ORDER BY d.created_at ASC, d.id ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.onchain_deposits AS d
    SET confirmation_worker_id = p_owner_token,
        confirmation_lease_expires_at =
          pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => v_lease_seconds),
        updated_at = pg_catalog.clock_timestamp()
    FROM candidates AS c
    WHERE d.id = c.id
    RETURNING d.id
  )
  SELECT d.*
  FROM public.onchain_deposits AS d
  JOIN claimed AS c ON c.id = d.id
  ORDER BY d.created_at ASC, d.id ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_pending_deposit_confirmations(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_deposit_confirmations(text, integer, integer)
  TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.release_pending_deposit_confirmation_claim(
  p_deposit_id uuid,
  p_owner_token text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to release deposit confirmation claims'
      USING ERRCODE = '42501';
  END IF;

  IF p_deposit_id IS NULL OR p_owner_token IS NULL OR btrim(p_owner_token) = '' THEN
    RAISE EXCEPTION 'Invalid deposit confirmation claim release payload'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.onchain_deposits
  SET confirmation_worker_id = NULL,
      confirmation_lease_expires_at = NULL
  WHERE id = p_deposit_id
    AND confirmation_worker_id = p_owner_token;

  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.release_pending_deposit_confirmation_claim(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_pending_deposit_confirmation_claim(uuid, text)
  TO service_role, postgres;

-- Leased credit wrapper: the exact pending row identity and current lease are
-- locked and checked before invoking the single canonical financial RPC.
CREATE OR REPLACE FUNCTION public.process_deposit_atomic_with_lease(
  p_deposit_id uuid,
  p_lease_token text,
  p_destination_address text,
  p_asset_symbol text,
  p_network_code text,
  p_amount numeric,
  p_tx_hash text,
  p_output_index integer,
  p_block_number bigint,
  p_from_address text,
  p_token_contract text,
  p_confirmations integer,
  p_provider text,
  p_block_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_deposit public.onchain_deposits%ROWTYPE;
  v_result jsonb;
  v_saved_address text;
  v_requested_address text;
  v_deposit_record_id uuid;
  v_existing_deposit_block_hash text;
  v_rows integer;
  v_network text := upper(btrim(coalesce(p_network_code, '')));
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to confirm deposits'
      USING ERRCODE = '42501';
  END IF;

  IF p_deposit_id IS NULL
     OR p_lease_token IS NULL OR btrim(p_lease_token) = ''
     OR p_confirmations IS NULL OR p_confirmations < 0
     OR p_output_index IS NULL OR p_output_index < 0
     OR p_block_number IS NULL OR p_block_number <= 0
     OR p_block_hash IS NULL
     OR (
       v_network IN ('ETH', 'ERC20', 'BEP20')
       AND p_block_hash !~ '^0x[0-9a-fA-F]{64}$'
     )
     OR (
       v_network IN ('TRC20', 'BTC', 'LTC')
       AND p_block_hash !~ '^[0-9a-fA-F]{64}$'
     )
     OR v_network NOT IN ('ETH', 'ERC20', 'BEP20', 'TRC20', 'BTC', 'LTC') THEN
    RAISE EXCEPTION 'Invalid leased deposit confirmation or canonical block identity payload'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_deposit
  FROM public.onchain_deposits
  WHERE id = p_deposit_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_deposit.status <> 'PENDING'
     OR v_deposit.confirmation_worker_id IS DISTINCT FROM p_lease_token
     OR v_deposit.confirmation_lease_expires_at IS NULL
     OR v_deposit.confirmation_lease_expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'Active pending-deposit confirmation lease is required'
      USING ERRCODE = '42501';
  END IF;

  v_saved_address := CASE
    WHEN v_network IN ('ETH', 'ERC20', 'BEP20')
      THEN lower(btrim(coalesce(v_deposit.to_address, v_deposit.address)))
    ELSE btrim(coalesce(v_deposit.to_address, v_deposit.address))
  END;
  v_requested_address := CASE
    WHEN v_network IN ('ETH', 'ERC20', 'BEP20')
      THEN lower(btrim(coalesce(p_destination_address, '')))
    ELSE btrim(coalesce(p_destination_address, ''))
  END;

  IF v_deposit.tx_hash IS DISTINCT FROM p_tx_hash
     OR upper(v_deposit.network) IS DISTINCT FROM v_network
     OR upper(v_deposit.asset_symbol) IS DISTINCT FROM upper(btrim(coalesce(p_asset_symbol, '')))
     OR v_deposit.output_index IS DISTINCT FROM p_output_index
     OR v_deposit.amount IS DISTINCT FROM p_amount
     OR v_saved_address IS DISTINCT FROM v_requested_address THEN
    RAISE EXCEPTION 'Verified chain payload does not match the leased pending deposit identity'
      USING ERRCODE = '23514';
  END IF;

  v_result := public.process_deposit_atomic(
    p_destination_address,
    p_asset_symbol,
    p_network_code,
    p_amount,
    p_tx_hash,
    p_output_index,
    p_block_number,
    p_from_address,
    p_token_contract,
    p_confirmations,
    p_provider
  );

  IF v_result->>'success' = 'true'
     AND v_result->>'status' IN ('CONFIRMED', 'ALREADY_CREDITED') THEN
    -- Resolve and lock the canonical deposit row created/updated by the credit RPC.
    SELECT id, block_hash
      INTO v_deposit_record_id, v_existing_deposit_block_hash
      FROM public.deposits
     WHERE lower(btrim(tx_hash)) = lower(btrim(p_tx_hash))
       AND upper(btrim(chain)) = v_network
       AND output_index = p_output_index
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Canonical deposit row missing after successful credit RPC.'
        USING ERRCODE = '23514';
    END IF;

    IF (v_deposit.block_hash IS NOT NULL
        AND lower(v_deposit.block_hash) IS DISTINCT FROM lower(p_block_hash))
       OR (v_deposit.block_number IS NOT NULL
        AND v_deposit.block_number IS DISTINCT FROM p_block_number)
       OR (v_existing_deposit_block_hash IS NOT NULL
        AND lower(v_existing_deposit_block_hash) IS DISTINCT FROM lower(p_block_hash)) THEN
      RAISE EXCEPTION 'DEPOSIT_BLOCK_IDENTITY_CONFLICT: verified inclusion differs from previously persisted credit evidence.'
        USING ERRCODE = '23514';
    END IF;

    UPDATE public.onchain_deposits
       SET block_number = COALESCE(block_number, p_block_number),
           block_hash = COALESCE(block_hash, p_block_hash),
           confirmation_worker_id = NULL,
           confirmation_lease_expires_at = NULL,
           updated_at = pg_catalog.clock_timestamp()
     WHERE id = p_deposit_id
       AND confirmation_worker_id = p_lease_token
       AND (block_number IS NULL OR block_number = p_block_number)
       AND (block_hash IS NULL OR lower(block_hash) = lower(p_block_hash));

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'Could not atomically persist the on-chain deposit block identity and release its lease.'
        USING ERRCODE = '40001';
    END IF;

    UPDATE public.deposits
       SET block_number = p_block_number,
           block_hash = COALESCE(block_hash, p_block_hash)
     WHERE id = v_deposit_record_id
       AND (block_hash IS NULL OR lower(block_hash) = lower(p_block_hash));

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'Could not atomically persist the canonical deposit block identity.'
        USING ERRCODE = '40001';
    END IF;

    UPDATE public.ledger_entries
       SET metadata = COALESCE(metadata, '{}'::jsonb)
         || jsonb_build_object('block_number', p_block_number, 'block_hash', p_block_hash)
     WHERE reference_id = v_deposit_record_id::text
       AND type = 'deposit'
       AND user_id = v_deposit.user_id
       AND amount = p_amount
       AND asset = upper(btrim(p_asset_symbol));

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'Successful deposit credit is missing its single matching ledger identity row.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.process_deposit_atomic_with_lease(uuid, text, text, text, text, numeric, text, integer, bigint, text, text, integer, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_deposit_atomic_with_lease(uuid, text, text, text, text, numeric, text, integer, bigint, text, text, integer, text, text)
  TO service_role, postgres;


-- Harden the canonical crediting SECURITY DEFINER function against public-schema
-- object shadowing. Its tables are already schema-qualified.
DO $migration$
DECLARE
    v_oid OID;
    v_definition TEXT;
    v_updated TEXT;
    v_old TEXT := 'SET search_path TO ''public'', ''pg_temp''';
BEGIN
    v_oid := pg_catalog.to_regprocedure(
        'public.process_deposit_atomic(text,text,text,numeric,text,integer,bigint,text,text,integer,text)'
    );
    IF v_oid IS NULL THEN
        RAISE EXCEPTION 'Canonical process_deposit_atomic RPC is missing.';
    END IF;

    v_definition := pg_catalog.pg_get_functiondef(v_oid);
    IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
        RAISE EXCEPTION 'Unexpected process_deposit_atomic search_path; refusing an unverified function rewrite.';
    END IF;
    IF pg_catalog.strpos(
        pg_catalog.substr(v_definition, pg_catalog.strpos(v_definition, v_old) + pg_catalog.length(v_old)),
        v_old
    ) > 0 THEN
        RAISE EXCEPTION 'Duplicate search_path markers found in process_deposit_atomic.';
    END IF;

    v_updated := pg_catalog.replace(v_definition, v_old, 'SET search_path TO pg_catalog');
    IF pg_catalog.strpos(v_updated, 'SET search_path TO pg_catalog') = 0
       OR pg_catalog.strpos(v_updated, v_old) > 0 THEN
        RAISE EXCEPTION 'process_deposit_atomic search_path hardening verification failed.';
    END IF;

    EXECUTE v_updated;
END;
$migration$;

COMMIT;