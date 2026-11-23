BEGIN;

DO $precheck$
DECLARE
  v_release_def text;
  v_helper_def text;
  v_stats_def text;
BEGIN
  IF to_regprocedure('public.release_trade_escrow(uuid,uuid)') IS NULL
     OR to_regprocedure('public.record_platform_ledger_entry(text,text,numeric,text,uuid,text,text,text,text,text,jsonb)') IS NULL
     OR to_regprocedure('public.get_admin_financial_stats()') IS NULL THEN
    RAISE EXCEPTION 'Required escrow release, platform-ledger or admin-statistics function is missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.platform_ledger_entries'::regclass
      AND conname='platform_ledger_entries_entry_type_check'
      AND pg_get_constraintdef(oid) LIKE '%trade_fee_collected%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.platform_ledger_entries'::regclass
      AND conname='platform_ledger_entries_idempotency_key_key'
  ) THEN
    RAISE EXCEPTION 'Platform ledger must support trade_fee_collected and unique idempotency keys.';
  END IF;

  SELECT pg_get_functiondef('public.release_trade_escrow(uuid,uuid)'::regprocedure)
  INTO v_release_def;
  v_release_def := replace(v_release_def, E'\r\n', E'\n');

  IF strpos(v_release_def, 'Already released (idempotent success)') = 0
     OR strpos(v_release_def, '-- 7e. Update Trade State to Completed') = 0
     OR strpos(v_release_def, 'public.record_platform_ledger_entry') > 0
     OR strpos(v_release_def, 'trade_fee_collected') > 0 THEN
    RAISE EXCEPTION 'release_trade_escrow differs from the reviewed pre-fee contract; refusing rewrite.';
  END IF;

  SELECT pg_get_functiondef('public.record_platform_ledger_entry(text,text,numeric,text,uuid,text,text,text,text,text,jsonb)'::regprocedure)
  INTO v_helper_def;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid='public.record_platform_ledger_entry(text,text,numeric,text,uuid,text,text,text,text,text,jsonb)'::regprocedure
      AND p.prosecdef IS TRUE
      AND pg_get_userbyid(p.proowner)='postgres'
  ) THEN
    RAISE EXCEPTION 'Platform-ledger helper must remain postgres-owned SECURITY DEFINER.';
  END IF;

  SELECT pg_get_functiondef('public.get_admin_financial_stats()'::regprocedure)
  INTO v_stats_def;
  IF strpos(v_stats_def, $oldstat$WHERE status = 'released'$oldstat$) = 0 THEN
    RAISE EXCEPTION 'Admin financial-statistics function no longer matches its stale escrow-status filter.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.trades t
    WHERE upper(coalesce(t.escrow_status,''))='RELEASED'
      AND coalesce(t.escrow_fee,0)>0
      AND NOT EXISTS (
        SELECT 1 FROM public.platform_ledger_entries p
        WHERE p.idempotency_key='pf_p2pfee_' || t.id::text
          AND p.entry_type='trade_fee_collected'
          AND p.asset_code=t.crypto
          AND p.amount=t.escrow_fee
          AND p.direction='CREDIT'
          AND p.related_user_id=t.seller_id::uuid
          AND p.ref_table='trades'
          AND p.ref_id=t.id::text
      )
  ) THEN
    RAISE EXCEPTION 'Existing released trades are missing platform-fee ledger rows; reconcile them before changing the release routine.';
  END IF;
END;
$precheck$;

-- The helper uses schema-qualified tables throughout. An empty search_path
-- removes public-schema shadowing from this SECURITY DEFINER ledger writer.
ALTER FUNCTION public.record_platform_ledger_entry(text,text,numeric,text,uuid,text,text,text,text,text,jsonb)
  SET search_path = '';

DO $patch_release$
DECLARE
  v_definition text;
  v_updated text;
  v_replay_marker text := $marker$
    IF LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('completed', 'released') OR LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) IN ('completed', 'released') THEN
$marker$;
  v_active_marker text := '    -- 7e. Update Trade State to Completed';
  v_fee_block text := $fee$
        -- Record escrow revenue only after an actual release. Cancel and expiry
        -- routines refund the complete escrow amount and never execute this path.
        IF COALESCE(v_trade.escrow_fee, 0.0) > 0 THEN
            PERFORM public.record_platform_ledger_entry(
                p_entry_type := 'trade_fee_collected',
                p_asset_code := v_trade.crypto,
                p_amount := v_trade.escrow_fee,
                p_direction := 'CREDIT',
                p_related_user_id := v_trade.seller_id::UUID,
                p_ref_table := 'trades',
                p_ref_id := p_trade_id::TEXT,
                p_network_code := NULL,
                p_tx_hash := NULL,
                p_idempotency_key := 'pf_p2pfee_' || p_trade_id::TEXT,
                p_metadata := jsonb_build_object(
                    'crypto_amount', v_trade.crypto_amount,
                    'escrow_fee', v_trade.escrow_fee,
                    'fiat_amount', v_trade.fiat_amount,
                    'buyer_id', v_trade.buyer_id,
                    'seller_id', v_trade.seller_id,
                    'trade_id', p_trade_id,
                    'settlement', 'release'
                )
            );
        END IF;

$fee$;
BEGIN
  SELECT pg_get_functiondef('public.release_trade_escrow(uuid,uuid)'::regprocedure)
  INTO v_definition;
  v_definition := replace(v_definition, E'\r\n', E'\n');

  IF (length(v_definition) - length(replace(v_definition, v_replay_marker, ''))) / length(v_replay_marker) <> 1
     OR (length(v_definition) - length(replace(v_definition, v_active_marker, ''))) / length(v_active_marker) <> 1 THEN
    RAISE EXCEPTION 'Escrow release insertion anchors are missing or ambiguous.';
  END IF;

  -- Also post an unrecorded fee on a completed-trade replay. The helper validates
  -- the immutable idempotency-key contract and cannot double-credit revenue.
  v_updated := replace(v_definition, v_replay_marker, v_replay_marker || v_fee_block);
  v_updated := replace(v_updated, v_active_marker, v_fee_block || v_active_marker);

  IF (length(v_updated) - length(replace(v_updated, 'public.record_platform_ledger_entry', ''))) / length('public.record_platform_ledger_entry') <> 2
     OR (length(v_updated) - length(replace(v_updated, 'pf_p2pfee_', ''))) / length('pf_p2pfee_') <> 2 THEN
    RAISE EXCEPTION 'Escrow fee writer/replay postcondition failed.';
  END IF;

  EXECUTE v_updated;
END;
$patch_release$;

-- release_trade_escrow sets status to completed and escrow_status to RELEASED.
-- Use the authoritative terminal escrow state in admin fee reporting.
CREATE OR REPLACE FUNCTION public.get_admin_financial_stats()
RETURNS TABLE(
  total_deposited numeric,
  total_withdrawn numeric,
  total_user_gas_fees numeric,
  total_sweeper_fees numeric,
  total_escrow_fees numeric,
  total_transfer_fees numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE((SELECT SUM(amount) FROM public.deposits WHERE status = 'completed'), 0) AS total_deposited,
    COALESCE((SELECT SUM(amount) FROM public.withdrawals WHERE status = 'completed'), 0) AS total_withdrawn,
    COALESCE((SELECT SUM(gas_fee) FROM public.withdrawals WHERE status = 'completed'), 0) AS total_user_gas_fees,
    COALESCE((SELECT SUM(sweeper_fee_paid) FROM public.deposits), 0) AS total_sweeper_fees,
    COALESCE((SELECT SUM(escrow_fee) FROM public.trades WHERE UPPER(COALESCE(escrow_status::TEXT,'')) = 'RELEASED'), 0) AS total_escrow_fees,
    COALESCE((SELECT SUM(fee_amount) FROM public.transfers), 0) AS total_transfer_fees;
END;
$function$;

COMMIT;
