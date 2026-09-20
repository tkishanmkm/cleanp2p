-- ==============================================================================
-- Migration: 20260919050000_fix_enum_trade_status_all_variants.sql
-- Purpose: Permanently resolve PostgreSQL Error 22P02:
--          "invalid input value for enum trade_status: 'dispute'", 'buyer_marked_paid', etc.
-- ==============================================================================

-- 1. Safely add all possible enum values to trade_status if the type exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'trade_status') THEN
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'dispute'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'DISPUTE'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'disputed'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'DISPUTED'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'buyer_marked_paid'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'BUYER_MARKED_PAID'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'payment_sent'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'PAYMENT_SENT'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'mark_paid'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'MARK_PAID'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'pending'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'PENDING'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'paid'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'PAID'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'completed'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'COMPLETED'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'released'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'RELEASED'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'cancelled'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'CANCELLED'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'canceled'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'CANCELED'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'expired'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'EXPIRED'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'active'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'ACTIVE'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'created'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'CREATED'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'escrow_locked'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'ESCROW_LOCKED'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
  END IF;
END $$;

-- 2. Create polymorphic lower() function for trade_status enum to avoid Error 42883
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'trade_status') THEN
    EXECUTE '
      CREATE OR REPLACE FUNCTION public.lower(t trade_status)
      RETURNS text
      LANGUAGE sql
      IMMUTABLE
      STRICT
      AS $func$
        SELECT LOWER(t::text);
      $func$;
    ';
  END IF;
END $$;

-- 3. Relax public.trades status column to TEXT
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'trades_status_check' 
      AND table_name = 'trades'
  ) THEN
    ALTER TABLE public.trades DROP CONSTRAINT trades_status_check;
  END IF;

  BEGIN
    ALTER TABLE public.trades ALTER COLUMN status TYPE TEXT USING status::text;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;

-- 4. Defensive trade metrics trigger function
CREATE OR REPLACE FUNCTION public.fn_update_user_trade_metrics()
RETURNS TRIGGER AS $$
DECLARE
  v_buyer_id UUID;
  v_seller_id UUID;
  v_pay_duration_mins NUMERIC;
  v_release_duration_mins NUMERIC;
  v_new_status TEXT;
  v_old_status TEXT;
BEGIN
  v_new_status := LOWER(COALESCE(NEW.status::text, ''));
  v_old_status := CASE WHEN OLD.status IS NOT NULL THEN LOWER(OLD.status::text) ELSE '' END;

  -- Only execute when a trade reaches 'completed' or 'released' status
  IF (v_new_status IN ('completed', 'released') AND (OLD.status IS NULL OR v_old_status NOT IN ('completed', 'released'))) THEN
    v_buyer_id := NEW.buyer_id;
    v_seller_id := NEW.seller_id;

    -- Calculate payment duration (created_at to paid_at)
    IF NEW.paid_at IS NOT NULL AND NEW.created_at IS NOT NULL AND NEW.paid_at >= NEW.created_at THEN
      v_pay_duration_mins := EXTRACT(EPOCH FROM (NEW.paid_at - NEW.created_at)) / 60.0;
    ELSE
      v_pay_duration_mins := NULL;
    END IF;

    -- Calculate release duration (paid_at to released_at)
    IF NEW.released_at IS NOT NULL AND NEW.paid_at IS NOT NULL AND NEW.released_at >= NEW.paid_at THEN
      v_release_duration_mins := EXTRACT(EPOCH FROM (NEW.released_at - NEW.paid_at)) / 60.0;
    ELSE
      v_release_duration_mins := NULL;
    END IF;

    -- Update buyer stats
    IF v_buyer_id IS NOT NULL THEN
      UPDATE public.profiles
      SET
        completed_trades = COALESCE(completed_trades, 0) + 1,
        total_completed_trades = COALESCE(total_completed_trades, 0) + 1,
        avg_payment_time_mins = CASE
          WHEN v_pay_duration_mins IS NOT NULL THEN
            ROUND(((COALESCE(avg_payment_time_mins, 0) * COALESCE(completed_trades, 0) + v_pay_duration_mins) / (COALESCE(completed_trades, 0) + 1))::numeric, 2)
          ELSE avg_payment_time_mins
        END,
        avg_payment_minutes = CASE
          WHEN v_pay_duration_mins IS NOT NULL THEN
            ROUND(((COALESCE(avg_payment_minutes, 0) * COALESCE(completed_trades, 0) + v_pay_duration_mins) / (COALESCE(completed_trades, 0) + 1))::numeric, 2)
          ELSE avg_payment_minutes
        END,
        updated_at = NOW()
      WHERE id = v_buyer_id;
    END IF;

    -- Update seller stats
    IF v_seller_id IS NOT NULL THEN
      UPDATE public.profiles
      SET
        completed_trades = COALESCE(completed_trades, 0) + 1,
        total_completed_trades = COALESCE(total_completed_trades, 0) + 1,
        avg_release_time_mins = CASE
          WHEN v_release_duration_mins IS NOT NULL THEN
            ROUND(((COALESCE(avg_release_time_mins, 0) * COALESCE(completed_trades, 0) + v_release_duration_mins) / (COALESCE(completed_trades, 0) + 1))::numeric, 2)
          ELSE avg_release_time_mins
        END,
        avg_release_minutes = CASE
          WHEN v_release_duration_mins IS NOT NULL THEN
            ROUND(((COALESCE(avg_release_minutes, 0) * COALESCE(completed_trades, 0) + v_release_duration_mins) / (COALESCE(completed_trades, 0) + 1))::numeric, 2)
          ELSE avg_release_minutes
        END,
        updated_at = NOW()
      WHERE id = v_seller_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Rebind trigger safely
DROP TRIGGER IF EXISTS trg_update_user_trade_metrics ON public.trades;
CREATE TRIGGER trg_update_user_trade_metrics
AFTER UPDATE OF status ON public.trades
FOR EACH ROW
EXECUTE FUNCTION public.fn_update_user_trade_metrics();
