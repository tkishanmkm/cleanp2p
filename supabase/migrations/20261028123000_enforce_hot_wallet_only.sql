-- Paxones custody policy: permit hot wallets only; never configure cold-wallet custody.
-- Fail closed if legacy cold_storage rows exist so no custody record is silently rewritten.
BEGIN;

DO $migration$
DECLARE
  v_constraint record;
BEGIN
  IF to_regclass('public.platform_wallets') IS NULL THEN
    RAISE EXCEPTION 'public.platform_wallets is missing; apply and validate its prerequisite migration first.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.platform_wallets
    WHERE role = 'cold_storage'
  ) THEN
    RAISE EXCEPTION 'Cold-storage custody rows exist; manual review is required before enforcing hot-wallet-only policy.';
  END IF;

  FOR v_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.platform_wallets'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%cold_storage%'
  LOOP
    EXECUTE format('ALTER TABLE public.platform_wallets DROP CONSTRAINT %I', v_constraint.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.platform_wallets'::regclass
      AND conname = 'platform_wallets_hot_only_role_check'
  ) THEN
    ALTER TABLE public.platform_wallets
      ADD CONSTRAINT platform_wallets_hot_only_role_check
      CHECK (role IN ('hot_wallet', 'fee_collector', 'escrow_pool'));
  END IF;
END;
$migration$;

COMMIT;
