-- Prevent an unhashed withdrawal refund while signed bytes or an EVM
-- nonce reservation still exist. This guard supplements worker-side checks
-- and must run after 20261106000000_harden_paired_withdrawal_settlement.sql.
BEGIN;

DO $migration$
DECLARE
  v_oid regprocedure := to_regprocedure(
    'public.process_failed_withdrawal(uuid,text,numeric,text,boolean)'
  );
  v_definition text;
  v_original text;
  v_old text;
  v_new text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Canonical process_failed_withdrawal RPC is missing.';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_oid)
    INTO v_definition;
  v_original := v_definition;

  -- The preceding paired-settlement migration must already have installed
  -- identity and transaction-hash checks for the mirror record.
  IF pg_catalog.strpos(v_definition, 'v_mirror public.withdrawals%ROWTYPE;') = 0
     OR pg_catalog.strpos(v_definition, 'PAIRED_WITHDRAWAL_HASH_MISMATCH') = 0
     OR pg_catalog.strpos(v_definition, 'v_mirror_hash text;') = 0 THEN
    RAISE EXCEPTION 'Paired withdrawal refund hardening is missing; apply 20261106000000 first.';
  END IF;

  IF pg_catalog.strpos(v_definition, 'WITHDRAWAL_DURABLE_PAYLOAD_REFUND_GUARD') > 0 THEN
    RAISE EXCEPTION 'Durable-payload refund guard already exists; refusing reapplication.';
  END IF;

  v_old := $old$
  IF v_hash IS NULL THEN
    IF v_mirror_hash IS NOT NULL THEN
$old$;

  v_new := $new$
  IF v_hash IS NULL THEN
    -- WITHDRAWAL_DURABLE_PAYLOAD_REFUND_GUARD
    -- A missing canonical hash is not proof of an unbroadcast transaction.
    -- The signed bytes may have been persisted while the hash/mirror state
    -- requires reconciliation. Never return the reservation in that state.
    IF EXISTS (
      SELECT 1
      FROM public.onchain_withdrawal_broadcasts b
      WHERE b.withdrawal_id = p_withdrawal_id
    ) THEN
      RAISE EXCEPTION 'Durable signed withdrawal payload exists; automatic unbroadcast refund is prohibited'
        USING ERRCODE = 'P0001', DETAIL = 'WITHDRAWAL_DURABLE_PAYLOAD_REFUND_BLOCKED';
    END IF;

    -- A RESERVED nonce may have been allocated immediately before a worker
    -- crash. Keep its funds reserved until the nonce is explicitly released.
    IF EXISTS (
      SELECT 1
      FROM public.onchain_withdrawal_nonce_reservations r
      WHERE r.withdrawal_id = p_withdrawal_id
        AND r.status <> 'RELEASED'
    ) THEN
      RAISE EXCEPTION 'An unreleased EVM withdrawal nonce reservation exists; automatic refund is prohibited'
        USING ERRCODE = 'P0001', DETAIL = 'WITHDRAWAL_NONCE_RESERVATION_REFUND_BLOCKED';
    END IF;

    IF v_mirror_hash IS NOT NULL THEN
$new$;

  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Unhashed refund guard insertion point has drifted; no changes made.';
  END IF;

  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  IF v_definition = v_original
     OR pg_catalog.strpos(v_definition, 'WITHDRAWAL_DURABLE_PAYLOAD_REFUND_GUARD') = 0
     OR pg_catalog.strpos(v_definition, 'public.onchain_withdrawal_broadcasts') = 0
     OR pg_catalog.strpos(v_definition, 'public.onchain_withdrawal_nonce_reservations') = 0
     OR pg_catalog.strpos(v_definition, 'r.status <> ''RELEASED''') = 0 THEN
    RAISE EXCEPTION 'Durable-payload/nonce refund guard patch verification failed.';
  END IF;

  EXECUTE v_definition;
END;
$migration$;

COMMIT;
