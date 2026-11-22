-- Pin TRON resource-pool RPC search paths and enforce lease/state/durability invariants.
BEGIN;

CREATE OR REPLACE FUNCTION public.claim_or_initialize_resource_delegation(
  p_sweep_id uuid,
  p_worker_id text,
  p_pool_address text,
  p_receiver_address text,
  p_delegated_amount_sun bigint,
  p_delegated_energy bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sweep public.sweep_operations%ROWTYPE;
  v_delegation public.resource_delegation_operations%ROWTYPE;
  v_delegation_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required for TRON resource delegation'
      USING ERRCODE = '42501';
  END IF;

  IF p_sweep_id IS NULL
     OR p_worker_id IS NULL OR btrim(p_worker_id) = ''
     OR p_pool_address IS NULL OR btrim(p_pool_address) = ''
     OR p_receiver_address IS NULL OR btrim(p_receiver_address) = ''
     OR p_delegated_amount_sun IS NULL OR p_delegated_amount_sun <= 0
     OR p_delegated_energy IS NULL OR p_delegated_energy <= 0
     OR p_delegated_amount_sun > 1000000000000000
     OR p_delegated_energy > 1000000000000 THEN
    RAISE EXCEPTION 'Invalid TRON resource-delegation payload'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_sweep
  FROM public.sweep_operations
  WHERE id = p_sweep_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_sweep.worker_id IS DISTINCT FROM p_worker_id
     OR v_sweep.lease_expires_at IS NULL
     OR v_sweep.lease_expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'TRON resource delegation requires the active sweep worker lease'
      USING ERRCODE = '42501';
  END IF;

  IF upper(coalesce(v_sweep.network, '')) NOT IN ('TRC20', 'TRON')
     OR upper(coalesce(v_sweep.asset_symbol, '')) <> 'USDT'
     OR upper(coalesce(v_sweep.status, '')) NOT IN ('CLAIMED', 'GAS_FUNDING', 'GAS_FUNDED') THEN
    RAISE EXCEPTION 'TRON resource delegation is not valid for this sweep network, asset or state'
      USING ERRCODE = '55000';
  END IF;

  SELECT *
    INTO v_delegation
  FROM public.resource_delegation_operations
  WHERE sweep_id = p_sweep_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_delegation.pool_address IS DISTINCT FROM btrim(p_pool_address)
       OR v_delegation.receiver_address IS DISTINCT FROM btrim(p_receiver_address) THEN
      RAISE EXCEPTION 'Existing TRON resource delegation destination does not match this sweep'
        USING ERRCODE = '23514';
    END IF;

    IF v_delegation.status IN ('DELEGATING', 'DELEGATED', 'UNDELEGATING') THEN
      RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'already_delegated', true,
        'status', v_delegation.status,
        'delegation_id', v_delegation.id,
        'delegated_amount_sun', v_delegation.delegated_amount_sun,
        'delegated_energy', v_delegation.delegated_energy,
        'delegation_tx_hash', v_delegation.delegation_tx_hash,
        'signed_delegation_hex', v_delegation.signed_delegation_hex,
        'undelegation_tx_hash', v_delegation.undelegation_tx_hash,
        'signed_undelegation_hex', v_delegation.signed_undelegation_hex
      );
    END IF;

    IF v_delegation.status = 'UNDELEGATED' AND v_delegation.verified_onchain_undelegated THEN
      RETURN pg_catalog.jsonb_build_object(
        'success', false,
        'code', 'ALREADY_UNDELEGATED',
        'message', 'The previous Energy delegation was fully reclaimed and cannot be reused'
      );
    END IF;

    IF v_delegation.status IN ('PENDING', 'FAILED')
       AND (
         nullif(btrim(coalesce(v_delegation.signed_delegation_hex, '')), '') IS NOT NULL
         OR nullif(btrim(coalesce(v_delegation.delegation_tx_hash, '')), '') IS NOT NULL
         OR nullif(btrim(coalesce(v_delegation.signed_undelegation_hex, '')), '') IS NOT NULL
         OR nullif(btrim(coalesce(v_delegation.undelegation_tx_hash, '')), '') IS NOT NULL
       ) THEN
      RETURN pg_catalog.jsonb_build_object(
        'success', false,
        'code', 'SIGNED_DELEGATION_RECOVERY_REQUIRED',
        'message', 'A failed resource operation still has signed transaction material and cannot be reset'
      );
    END IF;

    IF v_delegation.status NOT IN ('PENDING', 'FAILED') THEN
      RETURN pg_catalog.jsonb_build_object(
        'success', false,
        'code', 'INVALID_DELEGATION_STATE',
        'status', v_delegation.status,
        'message', 'Resource delegation is in a state that cannot be initialized'
      );
    END IF;

    UPDATE public.resource_delegation_operations
    SET pool_address = btrim(p_pool_address),
        receiver_address = btrim(p_receiver_address),
        delegated_amount_sun = p_delegated_amount_sun,
        delegated_energy = p_delegated_energy,
        status = 'PENDING',
        delegation_tx_hash = NULL,
        signed_delegation_hex = NULL,
        undelegation_tx_hash = NULL,
        signed_undelegation_hex = NULL,
        verified_onchain_undelegated = false,
        error_message = NULL,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_delegation.id
    RETURNING id INTO v_delegation_id;
  ELSE
    INSERT INTO public.resource_delegation_operations (
      sweep_id,
      pool_address,
      receiver_address,
      delegated_amount_sun,
      delegated_energy,
      status,
      verified_onchain_undelegated,
      created_at,
      updated_at
    )
    VALUES (
      p_sweep_id,
      btrim(p_pool_address),
      btrim(p_receiver_address),
      p_delegated_amount_sun,
      p_delegated_energy,
      'PENDING',
      false,
      pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp()
    )
    RETURNING id INTO v_delegation_id;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'already_delegated', false,
    'delegation_id', v_delegation_id,
    'status', 'PENDING',
    'delegated_amount_sun', p_delegated_amount_sun,
    'delegated_energy', p_delegated_energy
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.persist_signed_delegation(
  p_sweep_id uuid,
  p_worker_id text,
  p_signed_delegation_hex text,
  p_delegation_tx_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sweep public.sweep_operations%ROWTYPE;
  v_delegation public.resource_delegation_operations%ROWTYPE;
  v_signed jsonb;
  v_hash text := lower(btrim(coalesce(p_delegation_tx_hash, '')));
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to persist TRON delegation transactions'
      USING ERRCODE = '42501';
  END IF;

  IF p_sweep_id IS NULL
     OR p_worker_id IS NULL OR btrim(p_worker_id) = ''
     OR p_signed_delegation_hex IS NULL
     OR length(p_signed_delegation_hex) < 20
     OR length(p_signed_delegation_hex) > 1000000
     OR v_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid signed TRON delegation payload'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_signed := p_signed_delegation_hex::jsonb;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Signed TRON delegation JSON is invalid'
      USING ERRCODE = '22023';
  END;

  IF pg_catalog.jsonb_typeof(v_signed) IS DISTINCT FROM 'object'
     OR lower(coalesce(v_signed->>'txID', '')) IS DISTINCT FROM v_hash
     OR pg_catalog.jsonb_typeof(v_signed->'signature') IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_array_length(v_signed->'signature') < 1
     OR nullif(v_signed->>'raw_data_hex', '') IS NULL THEN
    RAISE EXCEPTION 'Signed TRON delegation hash/signature/raw-data validation failed'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_sweep
  FROM public.sweep_operations
  WHERE id = p_sweep_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_sweep.worker_id IS DISTINCT FROM p_worker_id
     OR v_sweep.lease_expires_at IS NULL
     OR v_sweep.lease_expires_at <= pg_catalog.clock_timestamp()
     OR upper(coalesce(v_sweep.status, '')) NOT IN ('CLAIMED', 'GAS_FUNDING', 'GAS_FUNDED')
     OR upper(coalesce(v_sweep.network, '')) NOT IN ('TRC20', 'TRON')
     OR upper(coalesce(v_sweep.asset_symbol, '')) <> 'USDT' THEN
    RAISE EXCEPTION 'Active TRON sweep lease/state is required to persist a delegation'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_delegation
  FROM public.resource_delegation_operations
  WHERE sweep_id = p_sweep_id
  FOR UPDATE;

  IF NOT FOUND OR v_delegation.status <> 'PENDING' THEN
    RAISE EXCEPTION 'TRON delegation must be in PENDING state before signing'
      USING ERRCODE = '55000';
  END IF;

  IF nullif(btrim(coalesce(v_delegation.signed_delegation_hex, '')), '') IS NOT NULL
     OR nullif(btrim(coalesce(v_delegation.delegation_tx_hash, '')), '') IS NOT NULL THEN
    RAISE EXCEPTION 'A signed TRON delegation already exists; replacement is forbidden'
      USING ERRCODE = '23505';
  END IF;

  UPDATE public.resource_delegation_operations
  SET status = 'DELEGATING',
      signed_delegation_hex = p_signed_delegation_hex,
      delegation_tx_hash = v_hash,
      error_message = NULL,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_delegation.id
    AND status = 'PENDING';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Signed TRON delegation could not be persisted';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'status', 'DELEGATING',
    'delegation_tx_hash', v_hash
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_delegation_status(
  p_sweep_id uuid,
  p_worker_id text,
  p_expected_status text,
  p_new_status text,
  p_error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sweep public.sweep_operations%ROWTYPE;
  v_delegation public.resource_delegation_operations%ROWTYPE;
  v_allowed boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to update TRON resource delegation state'
      USING ERRCODE = '42501';
  END IF;

  IF p_sweep_id IS NULL
     OR p_worker_id IS NULL OR btrim(p_worker_id) = ''
     OR p_expected_status IS NULL
     OR p_new_status IS NULL
     OR (p_error_message IS NOT NULL AND length(p_error_message) > 1000) THEN
    RAISE EXCEPTION 'Invalid TRON delegation state-transition payload'
      USING ERRCODE = '22023';
  END IF;

  v_allowed := (
    (p_expected_status = 'PENDING' AND p_new_status = 'FAILED')
    OR (p_expected_status = 'DELEGATING' AND p_new_status = 'DELEGATED')
    OR (p_expected_status = 'UNDELEGATING' AND p_new_status = 'FAILED')
  );
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Invalid TRON delegation transition: % -> %', p_expected_status, p_new_status
      USING ERRCODE = '55000';
  END IF;

  SELECT *
    INTO v_sweep
  FROM public.sweep_operations
  WHERE id = p_sweep_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_sweep.worker_id IS DISTINCT FROM p_worker_id
     OR v_sweep.lease_expires_at IS NULL
     OR v_sweep.lease_expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'Active sweep lease is required to update resource delegation state'
      USING ERRCODE = '42501';
  END IF;

  IF p_expected_status IN ('PENDING', 'DELEGATING')
     AND upper(coalesce(v_sweep.status, '')) NOT IN ('CLAIMED', 'GAS_FUNDING', 'GAS_FUNDED') THEN
    RAISE EXCEPTION 'Sweep is not in an allowed pre-broadcast state for delegation update'
      USING ERRCODE = '55000';
  END IF;

  IF p_expected_status = 'UNDELEGATING'
     AND upper(coalesce(v_sweep.status, '')) NOT IN ('READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED') THEN
    RAISE EXCEPTION 'Sweep is not in an allowed post-broadcast state for undelegation update'
      USING ERRCODE = '55000';
  END IF;

  SELECT *
    INTO v_delegation
  FROM public.resource_delegation_operations
  WHERE sweep_id = p_sweep_id
  FOR UPDATE;

  IF NOT FOUND OR v_delegation.status IS DISTINCT FROM p_expected_status THEN
    RAISE EXCEPTION 'TRON delegation state does not match the expected state'
      USING ERRCODE = '55000';
  END IF;

  IF p_new_status = 'DELEGATED'
     AND (
       nullif(btrim(coalesce(v_delegation.delegation_tx_hash, '')), '') IS NULL
       OR nullif(btrim(coalesce(v_delegation.signed_delegation_hex, '')), '') IS NULL
     ) THEN
    RAISE EXCEPTION 'Delegation cannot be marked DELEGATED without persisted signed transaction material'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.resource_delegation_operations
  SET status = p_new_status,
      error_message = left(coalesce(p_error_message, ''), 1000),
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_delegation.id;

  RETURN pg_catalog.jsonb_build_object('success', true, 'status', p_new_status);
END;
$function$;

CREATE OR REPLACE FUNCTION public.persist_signed_undelegation(
  p_sweep_id uuid,
  p_worker_id text,
  p_signed_undelegation_hex text,
  p_undelegation_tx_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sweep public.sweep_operations%ROWTYPE;
  v_delegation public.resource_delegation_operations%ROWTYPE;
  v_signed jsonb;
  v_hash text := lower(btrim(coalesce(p_undelegation_tx_hash, '')));
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to persist TRON undelegation transactions'
      USING ERRCODE = '42501';
  END IF;

  IF p_sweep_id IS NULL
     OR p_worker_id IS NULL OR btrim(p_worker_id) = ''
     OR p_signed_undelegation_hex IS NULL
     OR length(p_signed_undelegation_hex) < 20
     OR length(p_signed_undelegation_hex) > 1000000
     OR v_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid signed TRON undelegation payload'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_signed := p_signed_undelegation_hex::jsonb;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Signed TRON undelegation JSON is invalid'
      USING ERRCODE = '22023';
  END;

  IF pg_catalog.jsonb_typeof(v_signed) IS DISTINCT FROM 'object'
     OR lower(coalesce(v_signed->>'txID', '')) IS DISTINCT FROM v_hash
     OR pg_catalog.jsonb_typeof(v_signed->'signature') IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_array_length(v_signed->'signature') < 1
     OR nullif(v_signed->>'raw_data_hex', '') IS NULL THEN
    RAISE EXCEPTION 'Signed TRON undelegation hash/signature/raw-data validation failed'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_sweep
  FROM public.sweep_operations
  WHERE id = p_sweep_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_sweep.worker_id IS DISTINCT FROM p_worker_id
     OR v_sweep.lease_expires_at IS NULL
     OR v_sweep.lease_expires_at <= pg_catalog.clock_timestamp()
     OR upper(coalesce(v_sweep.network, '')) NOT IN ('TRC20', 'TRON')
     OR upper(coalesce(v_sweep.asset_symbol, '')) <> 'USDT'
     OR upper(coalesce(v_sweep.status, '')) NOT IN ('READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED') THEN
    RAISE EXCEPTION 'Active post-broadcast TRON sweep lease/state is required to persist undelegation'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_delegation
  FROM public.resource_delegation_operations
  WHERE sweep_id = p_sweep_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRON resource delegation record does not exist'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_delegation.status = 'UNDELEGATING'
     AND v_delegation.undelegation_tx_hash = v_hash
     AND v_delegation.signed_undelegation_hex = p_signed_undelegation_hex THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', true,
      'idempotent', true,
      'status', 'UNDELEGATING',
      'undelegation_tx_hash', v_hash
    );
  END IF;

  IF v_delegation.status <> 'DELEGATED'
     OR v_delegation.verified_onchain_undelegated THEN
    RAISE EXCEPTION 'Undelegation can only be created for a currently verified DELEGATED resource'
      USING ERRCODE = '55000';
  END IF;

  IF nullif(btrim(coalesce(v_delegation.signed_undelegation_hex, '')), '') IS NOT NULL
     OR nullif(btrim(coalesce(v_delegation.undelegation_tx_hash, '')), '') IS NOT NULL THEN
    RAISE EXCEPTION 'An undelegation transaction is already persisted; replacement is forbidden'
      USING ERRCODE = '23505';
  END IF;

  UPDATE public.resource_delegation_operations
  SET status = 'UNDELEGATING',
      signed_undelegation_hex = p_signed_undelegation_hex,
      undelegation_tx_hash = v_hash,
      error_message = NULL,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_delegation.id
    AND status = 'DELEGATED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Signed TRON undelegation could not be persisted';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'status', 'UNDELEGATING',
    'undelegation_tx_hash', v_hash
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_resource_undelegated(
  p_sweep_id uuid,
  p_worker_id text,
  p_undelegation_tx_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sweep public.sweep_operations%ROWTYPE;
  v_delegation public.resource_delegation_operations%ROWTYPE;
  v_signed jsonb;
  v_hash text := lower(btrim(coalesce(p_undelegation_tx_hash, '')));
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to confirm TRON resource undelegation'
      USING ERRCODE = '42501';
  END IF;

  IF p_sweep_id IS NULL
     OR p_worker_id IS NULL OR btrim(p_worker_id) = ''
     OR v_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid TRON undelegation confirmation payload'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_sweep
  FROM public.sweep_operations
  WHERE id = p_sweep_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_sweep.worker_id IS DISTINCT FROM p_worker_id
     OR v_sweep.lease_expires_at IS NULL
     OR v_sweep.lease_expires_at <= pg_catalog.clock_timestamp()
     OR upper(coalesce(v_sweep.network, '')) NOT IN ('TRC20', 'TRON')
     OR upper(coalesce(v_sweep.status, '')) NOT IN ('READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED') THEN
    RAISE EXCEPTION 'Active post-broadcast TRON sweep lease/state is required to confirm undelegation'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_delegation
  FROM public.resource_delegation_operations
  WHERE sweep_id = p_sweep_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRON resource delegation record does not exist'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_delegation.status = 'UNDELEGATED'
     AND v_delegation.verified_onchain_undelegated
     AND lower(coalesce(v_delegation.undelegation_tx_hash, '')) = v_hash THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', true,
      'already_confirmed', true,
      'status', 'UNDELEGATED'
    );
  END IF;

  IF v_delegation.status <> 'UNDELEGATING'
     OR lower(coalesce(v_delegation.undelegation_tx_hash, '')) IS DISTINCT FROM v_hash
     OR nullif(btrim(coalesce(v_delegation.signed_undelegation_hex, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Undelegation status, signed bytes or transaction hash does not match'
      USING ERRCODE = '55000';
  END IF;

  BEGIN
    v_signed := v_delegation.signed_undelegation_hex::jsonb;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Persisted TRON undelegation JSON is invalid'
      USING ERRCODE = '22023';
  END;

  IF lower(coalesce(v_signed->>'txID', '')) IS DISTINCT FROM v_hash
     OR pg_catalog.jsonb_typeof(v_signed->'signature') IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_array_length(v_signed->'signature') < 1
     OR nullif(v_signed->>'raw_data_hex', '') IS NULL THEN
    RAISE EXCEPTION 'Persisted TRON undelegation transaction integrity check failed'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.resource_delegation_operations
  SET status = 'UNDELEGATED',
      verified_onchain_undelegated = true,
      error_message = NULL,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_delegation.id
    AND status = 'UNDELEGATING';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRON resource undelegation could not be confirmed';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'status', 'UNDELEGATED',
    'verified_onchain_undelegated', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_or_initialize_resource_delegation(uuid,text,text,text,bigint,bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.persist_signed_delegation(uuid,text,text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_delegation_status(uuid,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.persist_signed_undelegation(uuid,text,text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_resource_undelegated(uuid,text,text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_or_initialize_resource_delegation(uuid,text,text,text,bigint,bigint)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.persist_signed_delegation(uuid,text,text,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.update_delegation_status(uuid,text,text,text,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.persist_signed_undelegation(uuid,text,text,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_resource_undelegated(uuid,text,text)
  TO service_role;

COMMIT;