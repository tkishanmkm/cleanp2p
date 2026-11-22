-- Protect persisted withdrawal signing payloads and cover READY_TO_BROADCAST finality.
BEGIN;

DO $migration$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.complete_onchain_withdrawal(uuid,text,numeric,text)'::regprocedure
  ) INTO v_definition;

  v_old := 'IF v_status NOT IN (''broadcasted'', ''processing'', ''ambiguous_broadcast'') THEN';
  v_new := 'IF v_status NOT IN (''ready_to_broadcast'', ''broadcasted'', ''processing'', ''ambiguous_broadcast'') THEN';
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Could not locate exact completion state guard; aborting migration';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  EXECUTE v_definition;

  SELECT pg_catalog.pg_get_functiondef(
    'public.process_failed_withdrawal(uuid,text,numeric,text,boolean)'::regprocedure
  ) INTO v_definition;

  v_old := 'OR v_status NOT IN (''broadcasted'', ''processing'', ''ambiguous_broadcast'') THEN';
  v_new := 'OR v_status NOT IN (''ready_to_broadcast'', ''broadcasted'', ''processing'', ''ambiguous_broadcast'') THEN';
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Could not locate exact failure state guard; aborting migration';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  EXECUTE v_definition;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.guard_onchain_withdrawal_broadcast_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_signed jsonb;
  v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Durable signed withdrawal payloads cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  v_status := upper(coalesce(NEW.status, ''));
  IF NEW.withdrawal_id IS NULL
     OR upper(coalesce(NEW.network, '')) NOT IN ('TRC20', 'ERC20', 'BEP20')
     OR nullif(btrim(coalesce(NEW.worker_id, '')), '') IS NULL
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

  IF v_status IN ('CONFIRMED', 'FAILED') AND NEW.worker_id IS NOT NULL THEN
    RAISE EXCEPTION 'Final withdrawal payload cannot retain a worker lease'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_onchain_withdrawal_broadcast_record
  ON public.onchain_withdrawal_broadcasts;

CREATE TRIGGER trg_guard_onchain_withdrawal_broadcast_record
BEFORE INSERT OR UPDATE OR DELETE ON public.onchain_withdrawal_broadcasts
FOR EACH ROW
EXECUTE FUNCTION public.guard_onchain_withdrawal_broadcast_record();

CREATE OR REPLACE FUNCTION public.guard_onchain_withdrawal_nonce_reservation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'RESERVED' THEN
      RAISE EXCEPTION 'A signed or used withdrawal nonce reservation cannot be deleted'
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.withdrawal_id IS NULL
     OR upper(coalesce(NEW.network, '')) NOT IN ('ERC20', 'BEP20')
     OR NEW.wallet_address !~* '^0x[0-9a-f]{40}$'
     OR NEW.nonce IS NULL OR NEW.nonce < 0
     OR upper(coalesce(NEW.status, '')) NOT IN ('RESERVED', 'SIGNED', 'BROADCASTED', 'RECOVERY_REQUIRED', 'CONFIRMED', 'FAILED', 'RELEASED') THEN
    RAISE EXCEPTION 'Invalid EVM withdrawal nonce reservation'
      USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'RESERVED' THEN
      RAISE EXCEPTION 'New withdrawal nonce reservations must start RESERVED'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.withdrawal_id IS DISTINCT FROM OLD.withdrawal_id
     OR upper(NEW.network) IS DISTINCT FROM upper(OLD.network)
     OR lower(NEW.wallet_address) IS DISTINCT FROM lower(OLD.wallet_address)
     OR NEW.nonce IS DISTINCT FROM OLD.nonce
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Withdrawal nonce reservation identity and nonce are immutable'
      USING ERRCODE = '23505';
  END IF;

  IF NOT (
    OLD.status = NEW.status
    OR (OLD.status = 'RESERVED' AND NEW.status IN ('SIGNED', 'RELEASED'))
    OR (OLD.status = 'SIGNED' AND NEW.status IN ('BROADCASTED', 'RECOVERY_REQUIRED', 'CONFIRMED', 'FAILED'))
    OR (OLD.status = 'RECOVERY_REQUIRED' AND NEW.status IN ('BROADCASTED', 'CONFIRMED', 'FAILED'))
    OR (OLD.status = 'BROADCASTED' AND NEW.status IN ('RECOVERY_REQUIRED', 'CONFIRMED', 'FAILED'))
  ) THEN
    RAISE EXCEPTION 'Invalid withdrawal nonce reservation transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_onchain_withdrawal_nonce_reservation
  ON public.onchain_withdrawal_nonce_reservations;

CREATE TRIGGER trg_guard_onchain_withdrawal_nonce_reservation
BEFORE INSERT OR UPDATE OR DELETE ON public.onchain_withdrawal_nonce_reservations
FOR EACH ROW
EXECUTE FUNCTION public.guard_onchain_withdrawal_nonce_reservation();

-- These private tables are used only by the authoritative service-role worker.
REVOKE ALL ON TABLE public.onchain_withdrawal_broadcasts
  FROM PUBLIC, anon, authenticated, supabase_auth_admin;
REVOKE ALL ON TABLE public.onchain_withdrawal_nonce_reservations
  FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT ALL ON TABLE public.onchain_withdrawal_broadcasts TO service_role;
GRANT ALL ON TABLE public.onchain_withdrawal_nonce_reservations TO service_role;

COMMIT;