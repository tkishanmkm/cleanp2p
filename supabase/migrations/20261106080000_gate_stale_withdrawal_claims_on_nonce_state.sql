-- Do not reclaim a stale PROCESSING withdrawal for fresh signing when its
-- durable signed payload is missing but its nonce reservation is already in
-- a signed/broadcast/recovery/terminal state. Only an unsigned RESERVED
-- nonce may be retried through the allocator's exact same-nonce safety checks.
BEGIN;

DO $migration$
DECLARE
  v_oid regprocedure := to_regprocedure(
    'public.claim_pending_withdrawals(integer,text)'
  );
  v_allocator_oid regprocedure := to_regprocedure(
    'public.allocate_onchain_withdrawal_nonce(uuid,text,text,text,bigint)'
  );
  v_definition text;
  v_allocator_definition text;
  v_old text;
  v_new text;
BEGIN
  IF v_oid IS NULL OR v_allocator_oid IS NULL THEN
    RAISE EXCEPTION 'Required withdrawal claim/nonce allocator RPC is missing.';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_oid)
    INTO v_definition;
  SELECT pg_catalog.pg_get_functiondef(v_allocator_oid)
    INTO v_allocator_definition;

  -- The allocator must reject non-unsigned reservations, persisted payload
  -- replacement attempts, and a nonce already consumed on-chain. The shared
  -- nonce migration must also serialize withdrawals against gas-funding.
  IF pg_catalog.strpos(v_allocator_definition, 'Nonce reservation is no longer unsigned') = 0
     OR pg_catalog.strpos(v_allocator_definition, 'Reserved nonce is already consumed on-chain; automatic re-signing is prohibited') = 0
     OR pg_catalog.strpos(v_allocator_definition, 'A durable broadcast record already exists; replacement signing is prohibited') = 0
     OR pg_catalog.strpos(v_allocator_definition, 'An earlier gas-funding nonce for this hot wallet is unresolved; reconcile it before withdrawal allocation') = 0
     OR pg_catalog.strpos(v_allocator_definition, 'An earlier withdrawal nonce for this hot wallet is unresolved; reconcile it before allocating another') = 0 THEN
    RAISE EXCEPTION 'Shared nonce allocator hardening is missing; apply 20261105170000 and 20261105180000 first.';
  END IF;

  IF pg_catalog.strpos(v_definition, 'WITHDRAWAL_STALE_PROCESSING_NONCE_STATE_GATE') > 0 THEN
    RAISE EXCEPTION 'Stale-processing nonce gate already exists; refusing reapplication.';
  END IF;

  v_old := $old$
        AND NOT EXISTS (
          SELECT 1
          FROM public.onchain_withdrawal_broadcasts b
          WHERE b.withdrawal_id = w.id
        )
      ) OR (
$old$;

  v_new := $new$
        AND NOT EXISTS (
          SELECT 1
          FROM public.onchain_withdrawal_broadcasts b
          WHERE b.withdrawal_id = w.id
        )
        -- WITHDRAWAL_STALE_PROCESSING_NONCE_STATE_GATE
        -- Only a never-signed RESERVED nonce can be retried by a fresh
        -- signing worker. All later states require exact-byte recovery.
        AND NOT EXISTS (
          SELECT 1
          FROM public.onchain_withdrawal_nonce_reservations r
          WHERE r.withdrawal_id = w.id
            AND upper(coalesce(r.status, '')) <> 'RESERVED'
        )
      ) OR (
$new$;

  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Stale PROCESSING claim anchor has drifted; no changes made.';
  END IF;

  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  IF v_definition IS NULL
     OR pg_catalog.strpos(v_definition, 'WITHDRAWAL_STALE_PROCESSING_NONCE_STATE_GATE') = 0
     OR pg_catalog.strpos(v_definition, $expected$upper(coalesce(r.status, '')) <> 'RESERVED'$expected$) = 0 THEN
    RAISE EXCEPTION 'Stale-processing nonce gate patch verification failed.';
  END IF;

  EXECUTE v_definition;
END;
$migration$;

COMMIT;
