-- Harden service-mediated withdrawal approval and rejection.
-- Bind both operations to the current active administrator identity, validate
-- the canonical/mirror records before state transitions, and require durable
-- audit evidence for idempotent approval/rejection replays.
BEGIN;

DO $migration$
DECLARE
  v_definition text;
  v_original text;
  v_old text;
  v_new text;
BEGIN
  IF to_regprocedure('public.approve_withdrawal(uuid,uuid)') IS NULL
     OR to_regprocedure('public.reject_withdrawal_pending_approval(uuid,uuid,text)') IS NULL
     OR to_regprocedure('public.is_active_admin_identity(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Required withdrawal review RPC or active-admin predicate is missing; no changes made.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = 'public.is_active_admin_identity(uuid)'::regprocedure
      AND prosecdef IS TRUE
      AND proconfig @> ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'Active-admin identity predicate is not SECURITY DEFINER with an empty search_path.';
  END IF;

  ---------------------------------------------------------------------------
  -- Approval: require current active admin and paired, unbroadcast records.
  ---------------------------------------------------------------------------
  SELECT pg_catalog.pg_get_functiondef(
    'public.approve_withdrawal(uuid,uuid)'::regprocedure
  ) INTO v_definition;
  v_original := v_definition;

  IF pg_catalog.strpos(v_definition, 'WITHDRAWAL_ADMIN_PAIR_MISMATCH') > 0 THEN
    RAISE EXCEPTION 'approve_withdrawal already contains the paired-state patch marker; refusing reapplication.';
  END IF;

  v_old := $approve_admin_old$
  SELECT EXISTS (
    SELECT 1 FROM public.app_admins a WHERE a.user_id = p_admin_id
    UNION
    SELECT 1 FROM public.profiles p WHERE p.id = p_admin_id AND (p.role = 'admin' OR p.is_admin = true OR p.is_admin_account = true)
    UNION
    SELECT 1 FROM auth.users u WHERE u.id = p_admin_id AND u.raw_app_meta_data->>'role' = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Caller is not an authorized administrator'
      USING ERRCODE = '42501';
  END IF;
$approve_admin_old$;
  v_new := $approve_admin_new$
  IF NOT public.is_active_admin_identity(p_admin_id) THEN
    RAISE EXCEPTION 'An active full administrator is required to approve withdrawals'
      USING ERRCODE = '42501';
  END IF;
$approve_admin_new$;

  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'approve_withdrawal administrator predicate anchor drifted; no changes made.';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := $approve_declaration_old$  v_rows integer := 0;$approve_declaration_old$;
  v_new := $approve_declaration_new$  v_rows integer := 0;
  v_admin_audit_exists boolean := false;$approve_declaration_new$;
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'approve_withdrawal declaration anchor drifted; no changes made.';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := $approve_pair_old$
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical on-chain withdrawal not found';
  END IF;

  IF lower(v_legacy.status) = 'queued' AND v_onchain.status = 'PENDING' THEN
$approve_pair_old$;
  v_new := $approve_pair_new$
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical on-chain withdrawal not found';
  END IF;

  IF v_legacy.user_id IS DISTINCT FROM v_onchain.user_id
     OR v_legacy.amount IS DISTINCT FROM v_onchain.amount
     OR pg_catalog.upper(pg_catalog.btrim(coalesce(
          nullif(v_legacy.asset_symbol, ''),
          nullif(v_legacy.asset_code, ''),
          nullif(v_legacy.token_symbol, ''),
          nullif(v_legacy.asset, ''),
          ''
        ))) IS DISTINCT FROM pg_catalog.upper(pg_catalog.btrim(coalesce(v_onchain.asset_symbol, '')))
     OR pg_catalog.upper(pg_catalog.btrim(coalesce(
          nullif(v_legacy.network_code, ''),
          nullif(v_legacy.network, ''),
          nullif(v_legacy.chain, ''),
          ''
        ))) IS DISTINCT FROM pg_catalog.upper(pg_catalog.btrim(coalesce(v_onchain.network, '')))
     OR coalesce(v_legacy.fee, v_legacy.network_fee, 0)
          IS DISTINCT FROM coalesce((v_onchain.metadata->>'fee')::numeric, v_onchain.fee, 0)
     OR nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(v_legacy.tx_hash, ''))), '') IS NOT NULL
     OR nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(v_legacy.txid, ''))), '') IS NOT NULL
     OR nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(v_onchain.tx_hash, ''))), '') IS NOT NULL THEN
    RAISE EXCEPTION 'Canonical and mirror withdrawal records differ or already contain a broadcast hash'
      USING ERRCODE = 'P0001', DETAIL = 'WITHDRAWAL_ADMIN_PAIR_MISMATCH';
  END IF;

  IF lower(v_legacy.status) = 'queued' AND v_onchain.status = 'PENDING' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.admin_audit_logs al
      WHERE al.action = 'ADMIN_APPROVED_WITHDRAWAL'
        AND al.details->>'withdrawal_id' = p_withdrawal_id::text
    ) INTO v_admin_audit_exists;

    IF NOT v_admin_audit_exists THEN
      RAISE EXCEPTION 'Queued withdrawal is missing its approval audit record; reconciliation is required'
        USING ERRCODE = 'P0001';
    END IF;
$approve_pair_new$;

  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'approve_withdrawal paired-record anchor drifted; no changes made.';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  IF v_definition = v_original
     OR pg_catalog.strpos(v_definition, 'public.is_active_admin_identity(p_admin_id)') = 0
     OR pg_catalog.strpos(v_definition, 'WITHDRAWAL_ADMIN_PAIR_MISMATCH') = 0
     OR pg_catalog.strpos(v_definition, 'ADMIN_APPROVED_WITHDRAWAL') = 0 THEN
    RAISE EXCEPTION 'approve_withdrawal active-identity/pair/audit patch verification failed.';
  END IF;
  EXECUTE v_definition;

  ---------------------------------------------------------------------------
  -- Rejection: use the installed pending-approval RPC with active admin and
  -- canonical/mirror/refund/audit consistency checks.
  ---------------------------------------------------------------------------
  SELECT pg_catalog.pg_get_functiondef(
    'public.reject_withdrawal_pending_approval(uuid,uuid,text)'::regprocedure
  ) INTO v_definition;
  v_original := v_definition;

  IF pg_catalog.strpos(v_definition, 'WITHDRAWAL_ADMIN_PAIR_MISMATCH') > 0 THEN
    RAISE EXCEPTION 'reject_withdrawal_pending_approval already contains the paired-state patch marker; refusing reapplication.';
  END IF;

  v_old := $reject_admin_old$
  SELECT EXISTS (
    SELECT 1 FROM public.app_admins a WHERE a.user_id = p_admin_id
    UNION
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_admin_id AND (p.role = 'admin' OR p.is_admin = true OR p.is_admin_account = true)
    UNION
    SELECT 1 FROM auth.users u WHERE u.id = p_admin_id AND u.raw_app_meta_data->>'role' = 'admin'
  ) INTO v_admin;

  IF NOT v_admin THEN
    RAISE EXCEPTION 'Caller is not an authorized administrator'
      USING ERRCODE = '42501';
  END IF;
$reject_admin_old$;
  v_new := $reject_admin_new$
  IF NOT public.is_active_admin_identity(p_admin_id) THEN
    RAISE EXCEPTION 'An active full administrator is required to reject withdrawals'
      USING ERRCODE = '42501';
  END IF;
$reject_admin_new$;

  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'reject_withdrawal_pending_approval administrator predicate anchor drifted; no changes made.';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := $reject_declaration_old$  v_refund_recorded boolean := false;$reject_declaration_old$;
  v_new := $reject_declaration_new$  v_refund_recorded boolean := false;
  v_admin_audit_exists boolean := false;$reject_declaration_new$;
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'reject_withdrawal_pending_approval declaration anchor drifted; no changes made.';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := $reject_pair_old$
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical on-chain withdrawal not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF lower(coalesce(v_legacy.status, '')) = 'rejected'
$reject_pair_old$;
  v_new := $reject_pair_new$
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical on-chain withdrawal not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_legacy.user_id IS DISTINCT FROM v_onchain.user_id
     OR v_legacy.amount IS DISTINCT FROM v_onchain.amount
     OR pg_catalog.upper(pg_catalog.btrim(coalesce(
          nullif(v_legacy.asset_symbol, ''),
          nullif(v_legacy.asset_code, ''),
          nullif(v_legacy.token_symbol, ''),
          nullif(v_legacy.asset, ''),
          ''
        ))) IS DISTINCT FROM pg_catalog.upper(pg_catalog.btrim(coalesce(v_onchain.asset_symbol, '')))
     OR pg_catalog.upper(pg_catalog.btrim(coalesce(
          nullif(v_legacy.network_code, ''),
          nullif(v_legacy.network, ''),
          nullif(v_legacy.chain, ''),
          ''
        ))) IS DISTINCT FROM pg_catalog.upper(pg_catalog.btrim(coalesce(v_onchain.network, '')))
     OR coalesce(v_legacy.fee, v_legacy.network_fee, 0)
          IS DISTINCT FROM coalesce((v_onchain.metadata->>'fee')::numeric, v_onchain.fee, 0)
     OR nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(v_legacy.tx_hash, ''))), '') IS NOT NULL
     OR nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(v_legacy.txid, ''))), '') IS NOT NULL
     OR nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(v_onchain.tx_hash, ''))), '') IS NOT NULL THEN
    RAISE EXCEPTION 'Canonical and mirror withdrawal records differ or already contain a broadcast hash'
      USING ERRCODE = 'P0001', DETAIL = 'WITHDRAWAL_ADMIN_PAIR_MISMATCH';
  END IF;

  IF lower(coalesce(v_legacy.status, '')) = 'rejected'
$reject_pair_new$;

  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'reject_withdrawal_pending_approval paired-record anchor drifted; no changes made.';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := $reject_replay_old$
    RETURN pg_catalog.jsonb_build_object(
      'success', true, 'idempotent', true,
      'withdrawal_id', p_withdrawal_id, 'status', 'REJECTED'
    );
$reject_replay_old$;
  v_new := $reject_replay_new$
    SELECT EXISTS (
      SELECT 1 FROM public.admin_audit_logs al
      WHERE al.action = 'ADMIN_REJECTED_WITHDRAWAL'
        AND al.details->>'withdrawal_id' = p_withdrawal_id::text
    ) INTO v_admin_audit_exists;

    IF NOT v_admin_audit_exists THEN
      RAISE EXCEPTION 'Rejected withdrawal is missing its administrative audit record; reconciliation is required'
        USING ERRCODE = 'P0001';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'success', true, 'idempotent', true,
      'withdrawal_id', p_withdrawal_id, 'status', 'REJECTED'
    );
$reject_replay_new$;

  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'reject_withdrawal_pending_approval replay audit anchor drifted; no changes made.';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := $reject_ledger_old$
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

  INSERT INTO public.admin_audit_logs (
$reject_ledger_old$;
  v_new := $reject_ledger_new$
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

  IF NOT EXISTS (
    SELECT 1 FROM public.ledger_entries le
    WHERE le.user_id = v_onchain.user_id
      AND le.type = 'withdrawal'
      AND le.reference_id = p_withdrawal_id::text
      AND le.idempotency_key = 'wreject_' || p_withdrawal_id::text
      AND le.amount = v_total
      AND le.metadata->>'event' = 'withdrawal_admin_rejected'
  ) THEN
    RAISE EXCEPTION 'Administrative rejection refund ledger record does not match the canonical withdrawal'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.admin_audit_logs (
$reject_ledger_new$;

  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'reject_withdrawal_pending_approval ledger verification anchor drifted; no changes made.';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  IF v_definition = v_original
     OR pg_catalog.strpos(v_definition, 'public.is_active_admin_identity(p_admin_id)') = 0
     OR pg_catalog.strpos(v_definition, 'WITHDRAWAL_ADMIN_PAIR_MISMATCH') = 0
     OR pg_catalog.strpos(v_definition, 'ADMIN_REJECTED_WITHDRAWAL') = 0
     OR pg_catalog.strpos(v_definition, 'Administrative rejection refund ledger record does not match') = 0 THEN
    RAISE EXCEPTION 'reject_withdrawal_pending_approval active-identity/pair/refund/audit patch verification failed.';
  END IF;
  EXECUTE v_definition;
END;
$migration$;

-- Both review RPCs remain SECURITY DEFINER and executable only by the server.
REVOKE ALL ON FUNCTION public.approve_withdrawal(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_withdrawal(uuid,uuid)
  TO service_role, postgres;

REVOKE ALL ON FUNCTION public.reject_withdrawal_pending_approval(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_withdrawal_pending_approval(uuid,uuid,text)
  TO service_role, postgres;

COMMIT;
