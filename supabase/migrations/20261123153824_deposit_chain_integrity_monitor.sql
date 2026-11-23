BEGIN;

ALTER TABLE public.onchain_deposits
  ADD COLUMN IF NOT EXISTS integrity_check_owner text,
  ADD COLUMN IF NOT EXISTS integrity_check_lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS integrity_check_last_at timestamptz,
  ADD COLUMN IF NOT EXISTS integrity_check_next_at timestamptz;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.onchain_deposits'::regclass
      AND conname = 'onchain_deposit_integrity_lease_state_check'
  ) THEN
    ALTER TABLE public.onchain_deposits
      ADD CONSTRAINT onchain_deposit_integrity_lease_state_check
      CHECK (
        (integrity_check_owner IS NULL AND integrity_check_lease_expires_at IS NULL)
        OR (
          integrity_check_owner IS NOT NULL
          AND pg_catalog.btrim(integrity_check_owner) <> ''
          AND integrity_check_lease_expires_at IS NOT NULL
        )
      );
  END IF;
END;
$constraints$;

CREATE INDEX IF NOT EXISTS idx_onchain_deposits_integrity_claim
  ON public.onchain_deposits (integrity_check_next_at, updated_at, id)
  WHERE status = 'CONFIRMED' AND block_number IS NOT NULL AND block_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.deposit_chain_integrity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  onchain_deposit_id uuid NOT NULL REFERENCES public.onchain_deposits(id) ON DELETE RESTRICT,
  network text NOT NULL CHECK (network IN ('ETH', 'ERC20', 'BEP20', 'TRC20', 'TRON', 'BTC', 'LTC')),
  tx_hash text NOT NULL,
  block_number bigint NOT NULL CHECK (block_number > 0),
  expected_block_hash text NOT NULL,
  observed_block_hash text NOT NULL,
  provider text NOT NULL,
  event_type text NOT NULL DEFAULT 'CANONICAL_BLOCK_MISMATCH'
    CHECK (event_type = 'CANONICAL_BLOCK_MISMATCH'),
  event_status text NOT NULL DEFAULT 'OPEN'
    CHECK (event_status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  occurrence_count integer NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  reviewed_at timestamptz,
  reviewed_by uuid,
  review_notes text,
  CONSTRAINT deposit_chain_integrity_hashes_differ_check
    CHECK (pg_catalog.lower(expected_block_hash) <> pg_catalog.lower(observed_block_hash)),
  CONSTRAINT deposit_chain_integrity_expected_hash_format_check
    CHECK (
      (network IN ('ETH', 'ERC20', 'BEP20') AND expected_block_hash ~ '^0x[0-9a-fA-F]{64}$')
      OR
      (network IN ('TRC20', 'TRON', 'BTC', 'LTC') AND expected_block_hash ~ '^[0-9a-fA-F]{64}$')
    ),
  CONSTRAINT deposit_chain_integrity_observed_hash_format_check
    CHECK (
      (network IN ('ETH', 'ERC20', 'BEP20') AND observed_block_hash ~ '^0x[0-9a-fA-F]{64}$')
      OR
      (network IN ('TRC20', 'TRON', 'BTC', 'LTC') AND observed_block_hash ~ '^[0-9a-fA-F]{64}$')
    ),
  CONSTRAINT uq_deposit_chain_integrity_observation
    UNIQUE (onchain_deposit_id, expected_block_hash, observed_block_hash)
);

CREATE INDEX IF NOT EXISTS idx_deposit_chain_integrity_events_open
  ON public.deposit_chain_integrity_events (event_status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_deposit_chain_integrity_events_deposit
  ON public.deposit_chain_integrity_events (onchain_deposit_id, last_seen_at DESC);

ALTER TABLE public.deposit_chain_integrity_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.deposit_chain_integrity_events FROM PUBLIC, anon, authenticated, service_role;

-- Keep alert deduplication available even when the older alert migration has
-- not yet been installed in the target database.
ALTER TABLE public.system_alerts
  ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_system_alerts_active_dedupe_key
  ON public.system_alerts (dedupe_key)
  WHERE is_resolved = FALSE AND dedupe_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_deposit_integrity_checks(
  p_owner_token text,
  p_limit integer DEFAULT 20,
  p_lease_seconds integer DEFAULT 180
)
RETURNS SETOF public.onchain_deposits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_limit integer := least(100, greatest(1, coalesce(p_limit, 20)));
  v_lease_seconds integer := least(600, greatest(30, coalesce(p_lease_seconds, 180)));
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to claim deposit integrity checks'
      USING ERRCODE = '42501';
  END IF;

  IF p_owner_token IS NULL OR pg_catalog.btrim(p_owner_token) = '' OR length(p_owner_token) > 128 THEN
    RAISE EXCEPTION 'A valid deposit integrity worker token is required'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT d.id
    FROM public.onchain_deposits AS d
    WHERE d.status = 'CONFIRMED'
      AND d.block_number IS NOT NULL
      AND d.block_number > 0
      AND d.block_hash IS NOT NULL
      AND (
        d.integrity_check_next_at IS NULL
        OR d.integrity_check_next_at <= pg_catalog.clock_timestamp()
      )
      AND (
        d.integrity_check_lease_expires_at IS NULL
        OR d.integrity_check_lease_expires_at <= pg_catalog.clock_timestamp()
      )
    ORDER BY d.integrity_check_next_at NULLS FIRST, d.updated_at ASC NULLS FIRST, d.id ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.onchain_deposits AS d
    SET integrity_check_owner = p_owner_token,
        integrity_check_lease_expires_at =
          pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => v_lease_seconds)
    FROM candidates AS c
    WHERE d.id = c.id
    RETURNING d.id
  )
  SELECT d.*
  FROM public.onchain_deposits AS d
  JOIN claimed AS c ON c.id = d.id
  ORDER BY d.integrity_check_next_at NULLS FIRST, d.updated_at ASC NULLS FIRST, d.id ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_deposit_integrity_check(
  p_deposit_id uuid,
  p_owner_token text,
  p_outcome text,
  p_observed_block_hash text,
  p_provider text,
  p_evidence jsonb DEFAULT '{}'::jsonb,
  p_next_check_seconds integer DEFAULT 3600
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_deposit public.onchain_deposits%ROWTYPE;
  v_network text;
  v_next_seconds integer := least(86400, greatest(60, coalesce(p_next_check_seconds, 3600)));
  v_event_id uuid;
  v_dedupe_key text;
  v_evidence jsonb := coalesce(p_evidence, '{}'::jsonb);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to complete deposit integrity checks'
      USING ERRCODE = '42501';
  END IF;

  IF p_deposit_id IS NULL
     OR p_owner_token IS NULL OR pg_catalog.btrim(p_owner_token) = ''
     OR p_outcome IS NULL OR p_outcome NOT IN ('MATCH', 'MISMATCH', 'INCONCLUSIVE')
     OR p_provider IS NULL OR pg_catalog.btrim(p_provider) = ''
     OR jsonb_typeof(v_evidence) IS DISTINCT FROM 'object'
     OR pg_catalog.octet_length(v_evidence::text) > 16384 THEN
    RAISE EXCEPTION 'Invalid deposit integrity check completion payload'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_deposit
  FROM public.onchain_deposits
  WHERE id = p_deposit_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_deposit.status <> 'CONFIRMED'
     OR v_deposit.block_number IS NULL
     OR v_deposit.block_hash IS NULL
     OR v_deposit.integrity_check_owner IS DISTINCT FROM p_owner_token
     OR v_deposit.integrity_check_lease_expires_at IS NULL
     OR v_deposit.integrity_check_lease_expires_at <= pg_catalog.clock_timestamp() THEN
    RETURN FALSE;
  END IF;

  v_network := upper(pg_catalog.btrim(v_deposit.network));

  IF p_outcome = 'MATCH' THEN
    IF p_observed_block_hash IS NULL
       OR pg_catalog.lower(p_observed_block_hash) <> pg_catalog.lower(v_deposit.block_hash) THEN
      RAISE EXCEPTION 'MATCH outcome must reproduce the persisted canonical block hash'
        USING ERRCODE = '23514';
    END IF;
  ELSIF p_outcome = 'MISMATCH' THEN
    IF p_observed_block_hash IS NULL
       OR pg_catalog.lower(p_observed_block_hash) = pg_catalog.lower(v_deposit.block_hash)
       OR (
         v_network IN ('ETH', 'ERC20', 'BEP20')
         AND p_observed_block_hash !~ '^0x[0-9a-fA-F]{64}$'
       )
       OR (
         v_network IN ('TRC20', 'TRON', 'BTC', 'LTC')
         AND p_observed_block_hash !~ '^[0-9a-fA-F]{64}$'
       ) THEN
      RAISE EXCEPTION 'MISMATCH outcome requires a different valid canonical block hash'
        USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.deposit_chain_integrity_events (
      onchain_deposit_id, network, tx_hash, block_number,
      expected_block_hash, observed_block_hash, provider, evidence
    )
    VALUES (
      v_deposit.id, v_network, v_deposit.tx_hash, v_deposit.block_number,
      v_deposit.block_hash, p_observed_block_hash, p_provider, v_evidence
    )
    ON CONFLICT (onchain_deposit_id, expected_block_hash, observed_block_hash)
    DO UPDATE SET
      event_status = CASE
        WHEN public.deposit_chain_integrity_events.event_status = 'RESOLVED' THEN 'OPEN'
        ELSE public.deposit_chain_integrity_events.event_status
      END,
      provider = EXCLUDED.provider,
      evidence = public.deposit_chain_integrity_events.evidence || EXCLUDED.evidence,
      occurrence_count = public.deposit_chain_integrity_events.occurrence_count + 1,
      last_seen_at = pg_catalog.clock_timestamp()
    RETURNING id INTO v_event_id;

    v_dedupe_key := 'deposit-chain-integrity:' || v_deposit.id::text;

    INSERT INTO public.system_alerts (
      alert_type, severity, title, message, metadata, is_resolved, dedupe_key
    )
    VALUES (
      'DEPOSIT_CHAIN_INTEGRITY',
      'CRITICAL',
      'Credited deposit block identity mismatch',
      'A canonical chain provider reports a different block hash at the height persisted when this deposit was credited. Manual investigation is required; customer balances were not changed.',
      jsonb_build_object(
        'event_id', v_event_id,
        'onchain_deposit_id', v_deposit.id,
        'network', v_network,
        'tx_hash', v_deposit.tx_hash,
        'block_number', v_deposit.block_number,
        'expected_block_hash', v_deposit.block_hash,
        'observed_block_hash', p_observed_block_hash,
        'provider', p_provider,
        'classification', 'possible_reorg_or_provider_divergence',
        'automatic_balance_reversal', false
      ),
      false,
      v_dedupe_key
    )
    ON CONFLICT (dedupe_key)
      WHERE is_resolved = FALSE AND dedupe_key IS NOT NULL
    DO UPDATE SET
      severity = 'CRITICAL',
      title = EXCLUDED.title,
      message = EXCLUDED.message,
      metadata = coalesce(public.system_alerts.metadata, '{}'::jsonb) || EXCLUDED.metadata;
  ELSIF p_outcome = 'INCONCLUSIVE' AND p_observed_block_hash IS NOT NULL THEN
    RAISE EXCEPTION 'INCONCLUSIVE outcome must not carry an observed block hash'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.onchain_deposits
  SET integrity_check_last_at = pg_catalog.clock_timestamp(),
      integrity_check_next_at =
        pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => v_next_seconds),
      integrity_check_owner = NULL,
      integrity_check_lease_expires_at = NULL
  WHERE id = p_deposit_id
    AND integrity_check_owner = p_owner_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deposit integrity lease was lost during completion'
      USING ERRCODE = '40001';
  END IF;

  RETURN TRUE;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_deposit_integrity_checks(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_deposit_integrity_checks(text, integer, integer)
  TO service_role, postgres;

REVOKE ALL ON FUNCTION public.complete_deposit_integrity_check(uuid, text, text, text, text, jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_deposit_integrity_check(uuid, text, text, text, text, jsonb, integer)
  TO service_role, postgres;

COMMIT;
