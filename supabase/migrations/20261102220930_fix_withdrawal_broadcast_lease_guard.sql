-- Permit worker-release states on durable withdrawal records while retaining lease checks before broadcast.
BEGIN;

CREATE OR REPLACE FUNCTION public.guard_onchain_withdrawal_broadcast_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_signed jsonb;
  v_status text := upper(coalesce(NEW.status, ''));
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Durable signed withdrawal payloads cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.withdrawal_id IS NULL
     OR upper(coalesce(NEW.network, '')) NOT IN ('TRC20', 'ERC20', 'BEP20')
     OR (v_status = 'READY_TO_BROADCAST'
         AND nullif(btrim(coalesce(NEW.worker_id, '')), '') IS NULL)
     OR nullif(btrim(coalesce(NEW.signed_tx, '')), '') IS NULL
     OR v_status NOT IN ('READY_TO_BROADCAST', 'RECOVERY_REQUIRED', 'BROADCASTED', 'CONFIRMED', 'FAILED') THEN
    RAISE EXCEPTION 'Invalid durable signed withdrawal broadcast record'
      USING ERRCODE = '22023';
  END IF;

  IF upper(NEW.network) = 'TRC20' THEN
    IF lower(NEW.tx_hash) !~ '^[0-9a-f]{64}$'
       OR NEW.nonce IS NOT NULL THEN
      RAISE EXCEPTION 'TRON signed withdrawal requires a 64-character txID and no EVM nonce'
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_signed := NEW.signed_tx::jsonb;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'TRON signed withdrawal payload is not valid JSON'
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
       OR length(NEW.signed_tx) % 2 <> 0 THEN
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
    (OLD.status = NEW.status)
    OR (OLD.status = 'READY_TO_BROADCAST' AND NEW.status IN ('BROADCASTED', 'RECOVERY_REQUIRED', 'CONFIRMED', 'FAILED'))
    OR (OLD.status = 'RECOVERY_REQUIRED' AND NEW.status IN ('BROADCASTED', 'CONFIRMED', 'FAILED'))
    OR (OLD.status = 'BROADCASTED' AND NEW.status IN ('RECOVERY_REQUIRED', 'CONFIRMED', 'FAILED'))
  ) THEN
    RAISE EXCEPTION 'Invalid durable withdrawal broadcast transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '55000';
  END IF;

  IF v_status IN ('BROADCASTED', 'CONFIRMED', 'FAILED') AND NEW.worker_id IS NOT NULL THEN
    RAISE EXCEPTION 'Broadcasted/final withdrawal payload cannot retain a worker lease'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;