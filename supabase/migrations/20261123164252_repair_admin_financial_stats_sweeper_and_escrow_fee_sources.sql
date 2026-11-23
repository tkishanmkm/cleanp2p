BEGIN;

DO $precheck$
DECLARE
  v_definition text;
  v_result text;
BEGIN
  SELECT pg_get_functiondef('public.get_admin_financial_stats()'::regprocedure)
  INTO v_definition;
  v_result := pg_get_function_result('public.get_admin_financial_stats()'::regprocedure);

  IF v_result NOT ILIKE '%total_sweeper_fees numeric%'
     OR strpos(v_definition, 'sweeper_fee_paid') = 0
     OR strpos(v_definition, 'escrow_status') = 0 THEN
    RAISE EXCEPTION 'Admin financial-statistics function differs from the reviewed return/filter contract.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.platform_ledger_entries'::regclass
      AND conname='platform_ledger_entries_entry_type_check'
      AND pg_get_constraintdef(oid) LIKE '%network_gas_expense%'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='platform_ledger_entries'
      AND column_name='usd_equivalent'
      AND data_type='numeric'
  ) THEN
    RAISE EXCEPTION 'Platform ledger lacks the USD-equivalent network gas expense contract.';
  END IF;
END;
$precheck$;

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
    -- Report only recorded USD-equivalent sweep/network-gas expenses. Never sum
    -- unlike native-coin amounts across BTC/LTC/ETH/USDT as if they shared units.
    COALESCE((
      SELECT SUM(usd_equivalent)
      FROM public.platform_ledger_entries
      WHERE entry_type = 'network_gas_expense'
        AND direction = 'DEBIT'
        AND ref_table IN ('sweep_operations', 'gas_funding_operations')
    ), 0) AS total_sweeper_fees,
    COALESCE((
      SELECT SUM(escrow_fee)
      FROM public.trades
      WHERE UPPER(COALESCE(escrow_status::TEXT,'')) = 'RELEASED'
    ), 0) AS total_escrow_fees,
    COALESCE((SELECT SUM(fee_amount) FROM public.transfers), 0) AS total_transfer_fees;
END;
$function$;

COMMIT;
