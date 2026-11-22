-- Paxones merchant profile schema foundation.
-- This migration adds only profile metadata. It does NOT move funds or enable
-- merchant applications; financial activation remains fail-closed until an
-- atomic wallet + ledger RPC is implemented and verified.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS merchant_tier TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS merchant_deposit_usdt NUMERIC(36, 18) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS merchant_applied_tier TEXT,
  ADD COLUMN IF NOT EXISTS merchant_status TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS total_volume_usd NUMERIC(36, 18) NOT NULL DEFAULT 0;

-- Validate existing values before enforcing tier/status constraints. If the
-- database already contains unexpected values, fail the migration instead of
-- silently rewriting customer records.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE merchant_tier IS NULL
       OR UPPER(merchant_tier) NOT IN ('NONE', 'GOLD', 'DIAMOND', 'ELITE')
  ) THEN
    RAISE EXCEPTION 'Invalid existing profiles.merchant_tier values; reconcile before applying merchant constraints';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE merchant_applied_tier IS NOT NULL
      AND UPPER(merchant_applied_tier) NOT IN ('GOLD', 'DIAMOND', 'ELITE')
  ) THEN
    RAISE EXCEPTION 'Invalid existing profiles.merchant_applied_tier values; reconcile before applying merchant constraints';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE merchant_status IS NULL
       OR UPPER(merchant_status) NOT IN ('NONE', 'PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED')
  ) THEN
    RAISE EXCEPTION 'Invalid existing profiles.merchant_status values; reconcile before applying merchant constraints';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE merchant_deposit_usdt < 0 OR total_volume_usd < 0
  ) THEN
    RAISE EXCEPTION 'Negative merchant deposit or volume found; reconcile before applying merchant constraints';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_merchant_tier_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_merchant_tier_check
      CHECK (UPPER(merchant_tier) IN ('NONE', 'GOLD', 'DIAMOND', 'ELITE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_merchant_applied_tier_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_merchant_applied_tier_check
      CHECK (merchant_applied_tier IS NULL OR UPPER(merchant_applied_tier) IN ('GOLD', 'DIAMOND', 'ELITE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_merchant_status_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_merchant_status_check
      CHECK (UPPER(merchant_status) IN ('NONE', 'PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_merchant_deposit_nonnegative_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_merchant_deposit_nonnegative_check
      CHECK (merchant_deposit_usdt >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_total_volume_nonnegative_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_total_volume_nonnegative_check
      CHECK (total_volume_usd >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.merchant_tier IS 'Current verified merchant tier; financial activation is controlled by a privileged atomic RPC.';
COMMENT ON COLUMN public.profiles.merchant_deposit_usdt IS 'USDT merchant security deposit tracked by the authoritative wallet and ledger.';
COMMENT ON COLUMN public.profiles.merchant_applied_tier IS 'Requested merchant tier awaiting review.';
COMMENT ON COLUMN public.profiles.merchant_status IS 'Merchant application lifecycle state.';
COMMENT ON COLUMN public.profiles.total_volume_usd IS 'Recorded USD-denominated trading volume; must be sourced from trusted trade settlement records.';

COMMIT;
