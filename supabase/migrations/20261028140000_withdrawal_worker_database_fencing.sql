-- Database-side fencing for withdrawal queue ownership.
-- Candidate migration only: validate on a schema-matched disposable database before deployment.
-- This does not prevent a chain transaction already in flight; stale outcomes are recorded as
-- AMBIGUOUS_BROADCAST while preserving reservations for reconciliation.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.withdrawal_worker_leases') IS NULL
     OR to_regclass('public.onchain_withdrawals') IS NULL
     OR to_regclass('public.withdrawals') IS NULL THEN
    RAISE EXCEPTION 'Withdrawal fencing preflight failed: required lease or paired withdrawal tables are missing';
  END IF;
  IF to_regprocedure('public.claim_pending_withdrawals(integer)') IS NULL
     OR to_regprocedure('public.record_withdrawal_broadcast(uuid,text)') IS NULL
     OR to_regprocedure('public.record_ambiguous_withdrawal_broadcast(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Withdrawal fencing preflight failed: expected legacy RPC signatures are missing';
  END IF;
END;
$preflight$;

ALTER TABLE public.onchain_withdrawals
  ADD COLUMN IF NOT EXISTS dispatch_owner_token uuid;

CREATE OR REPLACE FUNCTION public.claim_pending_withdrawals(
  p_owner_token uuid,
  p_limit integer DEFAULT 10
)
RETURNS SETOF public.onchain_withdrawals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_active_owner uuid;
  v_candidate record;
  v_claimed public.onchain_withdrawals%ROWTYPE;
BEGIN
  IF p_owner_token IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'A valid owner token and queue limit from 1 to 100 are required';
  END IF;

  -- Share-lock the lease row for this transaction so a new owner cannot replace it
  -- while this atomic claim is being committed.
  SELECT owner_token INTO v_active_owner
  FROM public.withdrawal_worker_leases
  WHERE lease_name = 'withdrawal-dispatch'
    AND owner_token = p_owner_token
    AND expires_at > now()
  FOR SHARE;

  IF NOT FOUND OR v_active_owner IS DISTINCT FROM p_owner_token THEN
    RAISE EXCEPTION 'Withdrawal worker lease is not active for this owner';
  END IF;

  -- Discover candidates without row locks, then lock the paired financial records
  -- in the global order: withdrawals first, onchain_withdrawals second. SKIP LOCKED
  -- allows another claimant/refund to win safely without a lock-order inversion.
  FOR v_candidate IN
    SELECT id
    FROM public.onchain_withdrawals
    WHERE upper(coalesce(status, '')) = 'PENDING'
    ORDER BY created_at ASC, id ASC
    LIMIT p_limit
  LOOP
    PERFORM 1
    FROM public.withdrawals
    WHERE id = v_candidate.id
      AND upper(coalesce(status, '')) IN ('QUEUED', 'PENDING', 'APPROVED')
    FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_claimed
    FROM public.onchain_withdrawals
    WHERE id = v_candidate.id
      AND upper(coalesce(status, '')) = 'PENDING'
    FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    UPDATE public.withdrawals
    SET status = 'processing', updated_at = now()
    WHERE id = v_candidate.id;

    UPDATE public.onchain_withdrawals
    SET status = 'PROCESSING',
        dispatch_owner_token = p_owner_token,
        updated_at = now()
    WHERE id = v_candidate.id
    RETURNING * INTO v_claimed;

    RETURN NEXT v_claimed;
  END LOOP;
  RETURN;
END;
$function$;

-- Revoke the old unfenced claim signature so no service-role caller can bypass the token.
REVOKE ALL ON FUNCTION public.claim_pending_withdrawals(integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_pending_withdrawals(integer) TO postgres;
REVOKE ALL ON FUNCTION public.claim_pending_withdrawals(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_withdrawals(uuid, integer) TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.record_withdrawal_broadcast(
  p_withdrawal_id uuid,
  p_tx_hash text,
  p_owner_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_owner uuid;
  v_lease_expires timestamptz;
  v_dispatch_owner uuid;
BEGIN
  IF p_withdrawal_id IS NULL OR p_owner_token IS NULL
     OR p_tx_hash IS NULL OR length(btrim(p_tx_hash)) = 0 OR length(btrim(p_tx_hash)) > 256 THEN
    RAISE EXCEPTION 'Withdrawal ID, owner token, and valid transaction hash are required';
  END IF;

  -- Lease first, then paired records, matching claim/lease and broadcast/refund lock ordering.
  SELECT owner_token, expires_at INTO v_owner, v_lease_expires
  FROM public.withdrawal_worker_leases
  WHERE lease_name = 'withdrawal-dispatch'
  FOR SHARE;
  IF NOT FOUND OR v_owner IS DISTINCT FROM p_owner_token OR v_lease_expires <= now() THEN
    RAISE EXCEPTION 'Withdrawal worker lease is not active for this owner';
  END IF;

  PERFORM 1 FROM public.withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal record % not found', p_withdrawal_id; END IF;

  SELECT dispatch_owner_token INTO v_dispatch_owner
  FROM public.onchain_withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'On-chain withdrawal % not found', p_withdrawal_id; END IF;
  IF v_dispatch_owner IS DISTINCT FROM p_owner_token THEN
    RAISE EXCEPTION 'Withdrawal % is not owned by this dispatch worker', p_withdrawal_id;
  END IF;

  RETURN public.record_withdrawal_broadcast(p_withdrawal_id, p_tx_hash);
END;
$function$;

-- The old implementation remains an internal helper only; direct service-role execution is revoked.
REVOKE ALL ON FUNCTION public.record_withdrawal_broadcast(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_withdrawal_broadcast(uuid, text) TO postgres;
REVOKE ALL ON FUNCTION public.record_withdrawal_broadcast(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_withdrawal_broadcast(uuid, text, uuid) TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.record_ambiguous_withdrawal_broadcast(
  p_withdrawal_id uuid,
  p_tx_hash text,
  p_error text,
  p_owner_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_dispatch_owner uuid;
  v_status text;
BEGIN
  IF p_withdrawal_id IS NULL OR p_owner_token IS NULL THEN
    RAISE EXCEPTION 'Withdrawal ID and owner token are required';
  END IF;

  -- A stale worker may have already broadcast before losing its lease. Permit only
  -- conservative ambiguity recording for the token persisted on this specific row;
  -- never release/refund funds through this path.
  PERFORM 1 FROM public.withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal record % not found', p_withdrawal_id; END IF;

  SELECT dispatch_owner_token, status INTO v_dispatch_owner, v_status
  FROM public.onchain_withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'On-chain withdrawal % not found', p_withdrawal_id; END IF;
  IF v_dispatch_owner IS DISTINCT FROM p_owner_token THEN
    RAISE EXCEPTION 'Withdrawal % is not owned by this dispatch worker', p_withdrawal_id;
  END IF;
  IF upper(coalesce(v_status, '')) IN ('COMPLETED', 'CONFIRMED', 'FAILED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Withdrawal % is terminal and cannot become ambiguous', p_withdrawal_id;
  END IF;

  RETURN public.record_ambiguous_withdrawal_broadcast(p_withdrawal_id, p_tx_hash, p_error);
END;
$function$;

REVOKE ALL ON FUNCTION public.record_ambiguous_withdrawal_broadcast(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_ambiguous_withdrawal_broadcast(uuid, text, text) TO postgres;
REVOKE ALL ON FUNCTION public.record_ambiguous_withdrawal_broadcast(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ambiguous_withdrawal_broadcast(uuid, text, text, uuid) TO service_role, postgres;

COMMIT;
