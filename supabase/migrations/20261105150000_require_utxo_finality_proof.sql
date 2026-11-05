-- Require persisted two-source canonical-chain evidence before confirming a BTC/LTC sweep.
BEGIN;

CREATE TABLE IF NOT EXISTS public.utxo_sweep_finality_proofs (
  sweep_id UUID PRIMARY KEY REFERENCES public.sweep_operations(id) ON DELETE RESTRICT,
  network TEXT NOT NULL CHECK (network IN ('BTC', 'LTC')),
  tx_hash TEXT NOT NULL CHECK (tx_hash ~* '^[0-9a-f]{64}$'),
  block_hash TEXT NOT NULL CHECK (block_hash ~* '^[0-9a-f]{64}$'),
  block_height BIGINT NOT NULL CHECK (block_height > 0),
  primary_tip_height BIGINT NOT NULL CHECK (primary_tip_height >= block_height),
  secondary_tip_height BIGINT NOT NULL CHECK (secondary_tip_height >= block_height),
  primary_source TEXT NOT NULL,
  secondary_source TEXT NOT NULL,
  required_confirmations INTEGER NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CHECK (primary_source <> secondary_source),
  CHECK (required_confirmations = CASE WHEN network = 'BTC' THEN 6 ELSE 12 END),
  CHECK (LEAST(primary_tip_height, secondary_tip_height) - block_height + 1 >= required_confirmations)
);

ALTER TABLE public.utxo_sweep_finality_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.utxo_sweep_finality_proofs
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;


CREATE OR REPLACE FUNCTION public.record_utxo_sweep_finality_proof(
  p_sweep_id UUID,
  p_worker_id TEXT,
  p_tx_hash TEXT,
  p_block_hash TEXT,
  p_block_height BIGINT,
  p_primary_tip_height BIGINT,
  p_secondary_tip_height BIGINT,
  p_primary_source TEXT,
  p_secondary_source TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sweep public.sweep_operations%ROWTYPE;
  v_network TEXT;
  v_required_confirmations INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  IF p_sweep_id IS NULL OR p_worker_id IS NULL
     OR pg_catalog.btrim(p_worker_id) = ''
     OR p_tx_hash IS NULL OR p_tx_hash !~* '^[0-9a-f]{64}$'
     OR p_block_hash IS NULL OR p_block_hash !~* '^[0-9a-f]{64}$'
     OR p_block_height IS NULL OR p_block_height <= 0
     OR p_primary_tip_height IS NULL OR p_secondary_tip_height IS NULL
     OR pg_catalog.length(coalesce(p_primary_source, '')) < 3
     OR pg_catalog.length(coalesce(p_secondary_source, '')) < 3
     OR pg_catalog.lower(p_primary_source) = pg_catalog.lower(p_secondary_source) THEN
    RAISE EXCEPTION 'Invalid UTXO finality proof payload' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_sweep
  FROM public.sweep_operations
  WHERE id = p_sweep_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_sweep.worker_id IS DISTINCT FROM p_worker_id
     OR v_sweep.lease_expires_at IS NULL
     OR v_sweep.lease_expires_at <= pg_catalog.clock_timestamp()
     OR v_sweep.status NOT IN ('READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED') THEN
    RAISE EXCEPTION 'Active worker lease and reconcilable sweep state are required'
      USING ERRCODE = '42501';
  END IF;

  v_network := pg_catalog.upper(pg_catalog.btrim(coalesce(v_sweep.network, '')));
  IF v_network NOT IN ('BTC', 'LTC')
     OR v_sweep.sweep_tx_hash IS NULL
     OR pg_catalog.lower(v_sweep.sweep_tx_hash) <> pg_catalog.lower(p_tx_hash) THEN
    RAISE EXCEPTION 'Finality proof does not match the persisted BTC/LTC sweep identity'
      USING ERRCODE = '23514';
  END IF;

  v_required_confirmations := CASE WHEN v_network = 'BTC' THEN 6 ELSE 12 END;
  IF p_primary_tip_height < p_block_height
     OR p_secondary_tip_height < p_block_height
     OR LEAST(p_primary_tip_height, p_secondary_tip_height) - p_block_height + 1 < v_required_confirmations THEN
    RAISE EXCEPTION 'UTXO transaction has insufficient confirmation depth'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.utxo_sweep_finality_proofs (
    sweep_id, network, tx_hash, block_hash, block_height,
    primary_tip_height, secondary_tip_height,
    primary_source, secondary_source, required_confirmations
  ) VALUES (
    p_sweep_id, v_network, pg_catalog.lower(p_tx_hash), pg_catalog.lower(p_block_hash), p_block_height,
    p_primary_tip_height, p_secondary_tip_height,
    p_primary_source, p_secondary_source, v_required_confirmations
  )
  ON CONFLICT (sweep_id) DO UPDATE
  SET block_hash = EXCLUDED.block_hash,
      block_height = EXCLUDED.block_height,
      primary_tip_height = EXCLUDED.primary_tip_height,
      secondary_tip_height = EXCLUDED.secondary_tip_height,
      primary_source = EXCLUDED.primary_source,
      secondary_source = EXCLUDED.secondary_source,
      required_confirmations = EXCLUDED.required_confirmations,
      recorded_at = pg_catalog.clock_timestamp()
  WHERE public.utxo_sweep_finality_proofs.network = EXCLUDED.network
    AND public.utxo_sweep_finality_proofs.tx_hash = EXCLUDED.tx_hash;

  IF NOT EXISTS (
    SELECT 1
    FROM public.utxo_sweep_finality_proofs AS proof
    WHERE proof.sweep_id = p_sweep_id
      AND proof.network = v_network
      AND proof.tx_hash = pg_catalog.lower(p_tx_hash)
      AND proof.block_hash = pg_catalog.lower(p_block_hash)
      AND proof.block_height = p_block_height
      AND proof.primary_tip_height = p_primary_tip_height
      AND proof.secondary_tip_height = p_secondary_tip_height
      AND proof.primary_source = p_primary_source
      AND proof.secondary_source = p_secondary_source
      AND proof.required_confirmations = v_required_confirmations
  ) THEN
    RAISE EXCEPTION 'Existing finality proof conflicts with the newly observed canonical-chain evidence'
      USING ERRCODE = '23514';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'sweep_id', p_sweep_id,
    'tx_hash', pg_catalog.lower(p_tx_hash),
    'required_confirmations', v_required_confirmations
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_utxo_sweep_finality_proof(UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.record_utxo_sweep_finality_proof(UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT, BIGINT, TEXT, TEXT)
  TO service_role, postgres;


CREATE OR REPLACE FUNCTION public.require_utxo_sweep_finality_before_confirmation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'CONFIRMED'
     AND pg_catalog.upper(coalesce(NEW.network, '')) IN ('BTC', 'LTC')
     AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.utxo_sweep_finality_proofs AS proof
      WHERE proof.sweep_id = NEW.id
        AND proof.network = pg_catalog.upper(NEW.network)
        AND proof.tx_hash = pg_catalog.lower(NEW.sweep_tx_hash)
        AND proof.required_confirmations = CASE
          WHEN pg_catalog.upper(NEW.network) = 'BTC' THEN 6 ELSE 12
        END
        AND LEAST(proof.primary_tip_height, proof.secondary_tip_height)
              - proof.block_height + 1 >= proof.required_confirmations
        AND proof.recorded_at >= pg_catalog.clock_timestamp() - INTERVAL '15 minutes'
    ) THEN
      RAISE EXCEPTION 'BTC/LTC sweep cannot be confirmed without persisted two-source canonical finality proof'
        USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_require_utxo_sweep_finality_before_confirmation
  ON public.sweep_operations;
CREATE TRIGGER trg_require_utxo_sweep_finality_before_confirmation
BEFORE UPDATE OF status ON public.sweep_operations
FOR EACH ROW
EXECUTE FUNCTION public.require_utxo_sweep_finality_before_confirmation();

REVOKE ALL ON FUNCTION public.require_utxo_sweep_finality_before_confirmation()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.require_utxo_sweep_finality_before_confirmation() TO postgres;

COMMIT;
