-- Migration: 20260917000000_add_reserved_balance_and_sync.sql
-- Description: Ensures reserved_balance and locked_balance columns exist across all wallet/balance tables and remain synchronized.

-- 1. Add reserved_balance and locked_balance columns across all wallet/balance tables
ALTER TABLE IF EXISTS public.wallets 
    ADD COLUMN IF NOT EXISTS reserved_balance NUMERIC(28, 8) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS locked_balance NUMERIC(28, 8) DEFAULT 0;

ALTER TABLE IF EXISTS public.user_wallets 
    ADD COLUMN IF NOT EXISTS reserved_balance NUMERIC(28, 8) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS locked_balance NUMERIC(28, 8) DEFAULT 0;

ALTER TABLE IF EXISTS public.balances 
    ADD COLUMN IF NOT EXISTS reserved_balance NUMERIC(28, 8) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS locked_balance NUMERIC(28, 8) DEFAULT 0;

ALTER TABLE IF EXISTS public.user_balances 
    ADD COLUMN IF NOT EXISTS reserved_balance NUMERIC(28, 8) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS locked_balance NUMERIC(28, 8) DEFAULT 0;

ALTER TABLE IF EXISTS public.wallet_assets 
    ADD COLUMN IF NOT EXISTS reserved_balance NUMERIC(28, 8) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS locked_balance NUMERIC(28, 8) DEFAULT 0;

-- 2. Populate reserved_balance with existing locked_balance values
UPDATE public.wallets 
SET reserved_balance = COALESCE(locked_balance, 0) 
WHERE reserved_balance IS NULL OR reserved_balance = 0;

UPDATE public.user_wallets 
SET reserved_balance = COALESCE(locked_balance, 0) 
WHERE reserved_balance IS NULL OR reserved_balance = 0;

UPDATE public.balances 
SET reserved_balance = COALESCE(locked_balance, 0) 
WHERE reserved_balance IS NULL OR reserved_balance = 0;

-- 3. Automatic synchronization trigger so updates to either column sync both
CREATE OR REPLACE FUNCTION public.sync_wallet_locked_reserved_balances()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' OR TG_OP = 'INSERT' THEN
        IF NEW.reserved_balance IS DISTINCT FROM OLD.reserved_balance AND NEW.reserved_balance IS NOT NULL THEN
            NEW.locked_balance := NEW.reserved_balance;
        ELSIF NEW.locked_balance IS DISTINCT FROM OLD.locked_balance AND NEW.locked_balance IS NOT NULL THEN
            NEW.reserved_balance := NEW.locked_balance;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply sync triggers
DROP TRIGGER IF EXISTS trg_sync_wallets_balance ON public.wallets;
CREATE TRIGGER trg_sync_wallets_balance
BEFORE INSERT OR UPDATE ON public.wallets
FOR EACH ROW EXECUTE FUNCTION public.sync_wallet_locked_reserved_balances();

DROP TRIGGER IF EXISTS trg_sync_user_wallets_balance ON public.user_wallets;
CREATE TRIGGER trg_sync_user_wallets_balance
BEFORE INSERT OR UPDATE ON public.user_wallets
FOR EACH ROW EXECUTE FUNCTION public.sync_wallet_locked_reserved_balances();

DROP TRIGGER IF EXISTS trg_sync_balances ON public.balances;
CREATE TRIGGER trg_sync_balances
BEFORE INSERT OR UPDATE ON public.balances
FOR EACH ROW EXECUTE FUNCTION public.sync_wallet_locked_reserved_balances();
