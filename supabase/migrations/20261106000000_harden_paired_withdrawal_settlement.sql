-- Bind both withdrawal records before any terminal financial settlement.
-- The canonical on-chain row and the user-facing mirror must agree on identity,
-- asset/network, transaction hash and terminal state. Fail closed on drift.
BEGIN;

DO $migration$
DECLARE
    v_complete_oid regprocedure := to_regprocedure(
        'public.complete_onchain_withdrawal(uuid,text,numeric,text)'
    );
    v_failed_oid regprocedure := to_regprocedure(
        'public.process_failed_withdrawal(uuid,text,numeric,text,boolean)'
    );
    v_definition text;
    v_original text;
    v_old text;
    v_new text;
BEGIN
    IF v_complete_oid IS NULL OR v_failed_oid IS NULL THEN
        RAISE EXCEPTION 'Required canonical withdrawal settlement RPC signature is missing; no changes made.';
    END IF;

    ---------------------------------------------------------------------------
    -- Successful completion: lock and validate the mirror before settlement.
    ---------------------------------------------------------------------------
    SELECT pg_get_functiondef(v_complete_oid) INTO v_definition;
    v_original := v_definition;

    IF position('v_mirror public.withdrawals%ROWTYPE;' IN v_definition) > 0
       OR position('PAIRED_WITHDRAWAL_IDENTITY_MISMATCH' IN v_definition) > 0 THEN
        RAISE EXCEPTION 'complete_onchain_withdrawal already contains paired-settlement patch markers; refusing ambiguous reapplication.';
    END IF;

    v_old := $complete_decl_old$
  v_w public.onchain_withdrawals%ROWTYPE;
  v_status text;
$complete_decl_old$;
    v_new := $complete_decl_new$
  v_w public.onchain_withdrawals%ROWTYPE;
  v_mirror public.withdrawals%ROWTYPE;
  v_status text;
$complete_decl_new$;

    IF position(v_old IN v_definition) = 0 THEN
        RAISE EXCEPTION 'complete_onchain_withdrawal declaration anchor drifted; no changes made.';
    END IF;
    v_definition := replace(v_definition, v_old, v_new);

    v_old := $complete_select_old$
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical on-chain withdrawal not found'
      USING ERRCODE = 'P0002';
  END IF;

  v_status := lower(coalesce(v_w.status, ''));
$complete_select_old$;
    v_new := $complete_select_new$
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical on-chain withdrawal not found'
      USING ERRCODE = 'P0002';
  END IF;

  -- Lock the companion row in the same transaction as the canonical row.
  SELECT *
    INTO v_mirror
  FROM public.withdrawals
  WHERE id = p_withdrawal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Companion withdrawal mirror is missing; settlement requires reconciliation'
      USING ERRCODE = 'P0001', DETAIL = 'WITHDRAWAL_MIRROR_MISSING';
  END IF;

  IF v_mirror.user_id IS DISTINCT FROM v_w.user_id
     OR v_mirror.amount IS DISTINCT FROM v_w.amount
     OR pg_catalog.upper(pg_catalog.btrim(coalesce(
          nullif(v_mirror.asset_symbol, ''),
          nullif(v_mirror.asset_code, ''),
          nullif(v_mirror.token_symbol, ''),
          nullif(v_mirror.asset, ''),
          ''
        ))) IS DISTINCT FROM pg_catalog.upper(pg_catalog.btrim(coalesce(v_w.asset_symbol, '')))
     OR pg_catalog.upper(pg_catalog.btrim(coalesce(
          nullif(v_mirror.network_code, ''),
          nullif(v_mirror.network, ''),
          nullif(v_mirror.chain, ''),
          ''
        ))) IS DISTINCT FROM pg_catalog.upper(pg_catalog.btrim(coalesce(v_w.network, ''))) THEN
    RAISE EXCEPTION 'Canonical and mirror withdrawal identity differs; settlement requires reconciliation'
      USING ERRCODE = 'P0001', DETAIL = 'PAIRED_WITHDRAWAL_IDENTITY_MISMATCH';
  END IF;

  -- Broadcast persistence writes both columns to the same hash. Require both
  -- values to agree with the canonical hash before releasing reserved liability.
  IF nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(v_mirror.tx_hash, ''))), '') IS DISTINCT FROM v_hash
     OR nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(v_mirror.txid, ''))), '') IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'Canonical and mirror withdrawal transaction hashes differ; settlement requires reconciliation'
      USING ERRCODE = 'P0001', DETAIL = 'PAIRED_WITHDRAWAL_HASH_MISMATCH';
  END IF;

  v_status := lower(coalesce(v_w.status, ''));
$complete_select_new$;

    IF position(v_old IN v_definition) = 0 THEN
        RAISE EXCEPTION 'complete_onchain_withdrawal canonical-row anchor drifted; no changes made.';
    END IF;
    v_definition := replace(v_definition, v_old, v_new);

    v_old := $complete_mirror_old$
    IF NOT EXISTS (SELECT 1 FROM public.withdrawals mirror WHERE mirror.id = p_withdrawal_id) THEN
      RAISE EXCEPTION 'Completed withdrawal mirror is missing';
    END IF;
$complete_mirror_old$;
    v_new := $complete_mirror_new$
    IF lower(coalesce(v_mirror.status, '')) NOT IN ('completed', 'confirmed') THEN
      RAISE EXCEPTION 'Completed withdrawal mirror status differs; manual reconciliation required'
        USING ERRCODE = 'P0001', DETAIL = 'PAIRED_WITHDRAWAL_TERMINAL_STATE_MISMATCH';
    END IF;
$complete_mirror_new$;

    IF position(v_old IN v_definition) = 0 THEN
        RAISE EXCEPTION 'complete_onchain_withdrawal completed-state mirror anchor drifted; no changes made.';
    END IF;
    v_definition := replace(v_definition, v_old, v_new);

    v_old := $complete_state_old$
  IF v_status NOT IN ('ready_to_broadcast', 'broadcasted', 'processing', 'ambiguous_broadcast') THEN
$complete_state_old$;
    v_new := $complete_state_new$
  IF lower(coalesce(v_mirror.status, '')) IN ('completed', 'confirmed', 'failed', 'cancelled', 'canceled', 'rejected') THEN
    RAISE EXCEPTION 'Canonical and mirror withdrawal terminal states differ; settlement requires reconciliation'
      USING ERRCODE = 'P0001', DETAIL = 'PAIRED_WITHDRAWAL_TERMINAL_STATE_MISMATCH';
  END IF;

  IF v_status NOT IN ('ready_to_broadcast', 'broadcasted', 'processing', 'ambiguous_broadcast') THEN
$complete_state_new$;

    IF position(v_old IN v_definition) = 0 THEN
        RAISE EXCEPTION 'complete_onchain_withdrawal active-state anchor drifted; no changes made.';
    END IF;
    v_definition := replace(v_definition, v_old, v_new);

    IF v_definition = v_original
       OR position('PAIRED_WITHDRAWAL_IDENTITY_MISMATCH' IN v_definition) = 0
       OR position('PAIRED_WITHDRAWAL_HASH_MISMATCH' IN v_definition) = 0
       OR position('PAIRED_WITHDRAWAL_TERMINAL_STATE_MISMATCH' IN v_definition) = 0
       OR position('v_mirror public.withdrawals%ROWTYPE;' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'complete_onchain_withdrawal paired-settlement patch verification failed; no changes made.';
    END IF;

    EXECUTE v_definition;

    ---------------------------------------------------------------------------
    -- Failed/refunded withdrawal: never refund when the mirror contains a
    -- broadcast hash that is absent from or differs from the canonical record.
    ---------------------------------------------------------------------------
    SELECT pg_get_functiondef(v_failed_oid) INTO v_definition;
    v_original := v_definition;

    IF position('v_mirror public.withdrawals%ROWTYPE;' IN v_definition) > 0
       OR position('PAIRED_WITHDRAWAL_HASH_MISMATCH' IN v_definition) > 0 THEN
        RAISE EXCEPTION 'process_failed_withdrawal already contains paired-settlement patch markers; refusing ambiguous reapplication.';
    END IF;

    v_old := $failed_decl_old$
  v_w public.onchain_withdrawals%ROWTYPE;
  v_status text;
  v_hash text;
$failed_decl_old$;
    v_new := $failed_decl_new$
  v_w public.onchain_withdrawals%ROWTYPE;
  v_mirror public.withdrawals%ROWTYPE;
  v_status text;
  v_hash text;
  v_mirror_hash text;
$failed_decl_new$;

    IF position(v_old IN v_definition) = 0 THEN
        RAISE EXCEPTION 'process_failed_withdrawal declaration anchor drifted; no changes made.';
    END IF;
    v_definition := replace(v_definition, v_old, v_new);

    v_old := $failed_select_old$
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical on-chain withdrawal not found'
      USING ERRCODE = 'P0002';
  END IF;

  v_status := lower(coalesce(v_w.status, ''));
  v_hash := nullif(lower(pg_catalog.btrim(coalesce(v_w.tx_hash, ''))), '');
$failed_select_old$;
    v_new := $failed_select_new$
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical on-chain withdrawal not found'
      USING ERRCODE = 'P0002';
  END IF;

  -- Lock and verify the mirror before considering any refund, including the
  -- pre-broadcast path where the canonical transaction hash is still empty.
  SELECT *
    INTO v_mirror
  FROM public.withdrawals
  WHERE id = p_withdrawal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Companion withdrawal mirror is missing; refund requires reconciliation'
      USING ERRCODE = 'P0001', DETAIL = 'WITHDRAWAL_MIRROR_MISSING';
  END IF;

  IF v_mirror.user_id IS DISTINCT FROM v_w.user_id
     OR v_mirror.amount IS DISTINCT FROM v_w.amount
     OR pg_catalog.upper(pg_catalog.btrim(coalesce(
          nullif(v_mirror.asset_symbol, ''),
          nullif(v_mirror.asset_code, ''),
          nullif(v_mirror.token_symbol, ''),
          nullif(v_mirror.asset, ''),
          ''
        ))) IS DISTINCT FROM pg_catalog.upper(pg_catalog.btrim(coalesce(v_w.asset_symbol, '')))
     OR pg_catalog.upper(pg_catalog.btrim(coalesce(
          nullif(v_mirror.network_code, ''),
          nullif(v_mirror.network, ''),
          nullif(v_mirror.chain, ''),
          ''
        ))) IS DISTINCT FROM pg_catalog.upper(pg_catalog.btrim(coalesce(v_w.network, ''))) THEN
    RAISE EXCEPTION 'Canonical and mirror withdrawal identity differs; refund requires reconciliation'
      USING ERRCODE = 'P0001', DETAIL = 'PAIRED_WITHDRAWAL_IDENTITY_MISMATCH';
  END IF;

  v_status := lower(coalesce(v_w.status, ''));
  v_hash := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(v_w.tx_hash, ''))), '');
  v_mirror_hash := coalesce(
    nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(v_mirror.tx_hash, ''))), ''),
    nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(v_mirror.txid, ''))), '')
  );

  IF v_hash IS NULL THEN
    IF v_mirror_hash IS NOT NULL THEN
      RAISE EXCEPTION 'Mirror contains a broadcast transaction hash absent from the canonical withdrawal; automatic refund denied'
        USING ERRCODE = 'P0001', DETAIL = 'PAIRED_WITHDRAWAL_HASH_MISMATCH';
    END IF;
  ELSE
    IF nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(v_mirror.tx_hash, ''))), '') IS DISTINCT FROM v_hash
       OR nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(v_mirror.txid, ''))), '') IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'Canonical and mirror withdrawal transaction hashes differ; refund requires reconciliation'
        USING ERRCODE = 'P0001', DETAIL = 'PAIRED_WITHDRAWAL_HASH_MISMATCH';
    END IF;
  END IF;
$failed_select_new$;

    IF position(v_old IN v_definition) = 0 THEN
        RAISE EXCEPTION 'process_failed_withdrawal canonical-row anchor drifted; no changes made.';
    END IF;
    v_definition := replace(v_definition, v_old, v_new);

    v_old := $failed_idempotent_old$
  IF v_status = 'failed' THEN
$failed_idempotent_old$;
    v_new := $failed_idempotent_new$
  IF v_status = 'failed' THEN
    IF lower(coalesce(v_mirror.status, '')) <> 'failed' THEN
      RAISE EXCEPTION 'Canonical failed withdrawal has a non-failed mirror state; refund requires reconciliation'
        USING ERRCODE = 'P0001', DETAIL = 'PAIRED_WITHDRAWAL_TERMINAL_STATE_MISMATCH';
    END IF;
$failed_idempotent_new$;

    IF position(v_old IN v_definition) = 0 THEN
        RAISE EXCEPTION 'process_failed_withdrawal failed-state anchor drifted; no changes made.';
    END IF;
    v_definition := replace(v_definition, v_old, v_new);

    v_old := $failed_terminal_old$
  IF v_status IN ('completed', 'confirmed', 'cancelled', 'rejected') THEN
$failed_terminal_old$;
    v_new := $failed_terminal_new$
  IF lower(coalesce(v_mirror.status, '')) IN ('completed', 'confirmed', 'failed', 'cancelled', 'canceled', 'rejected') THEN
    RAISE EXCEPTION 'Canonical and mirror withdrawal terminal states differ; refund requires reconciliation'
      USING ERRCODE = 'P0001', DETAIL = 'PAIRED_WITHDRAWAL_TERMINAL_STATE_MISMATCH';
  END IF;

  IF v_status IN ('completed', 'confirmed', 'cancelled', 'rejected') THEN
$failed_terminal_new$;

    IF position(v_old IN v_definition) = 0 THEN
        RAISE EXCEPTION 'process_failed_withdrawal terminal-state anchor drifted; no changes made.';
    END IF;
    v_definition := replace(v_definition, v_old, v_new);

    IF v_definition = v_original
       OR position('PAIRED_WITHDRAWAL_IDENTITY_MISMATCH' IN v_definition) = 0
       OR position('PAIRED_WITHDRAWAL_HASH_MISMATCH' IN v_definition) = 0
       OR position('PAIRED_WITHDRAWAL_TERMINAL_STATE_MISMATCH' IN v_definition) = 0
       OR position('v_mirror public.withdrawals%ROWTYPE;' IN v_definition) = 0
       OR position('v_mirror_hash text;' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'process_failed_withdrawal paired-settlement patch verification failed; no changes made.';
    END IF;

    EXECUTE v_definition;
END;
$migration$;

COMMIT;
