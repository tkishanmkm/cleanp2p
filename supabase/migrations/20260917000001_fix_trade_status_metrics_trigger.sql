-- ==============================================================================
-- Migration: Fix trade_status metrics trigger enum comparison
-- Purpose: Safely cast status column to text in fn_update_user_trade_metrics()
--          to eliminate PostgreSQL error 22P02 ("invalid input value for enum trade_status: 'COMPLETED'")
-- ==============================================================================

-- 1. Safely add enum values if supported
DO $$
BEGIN
  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'completed';
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  WHEN OTHERS THEN
    NULL;
  END;
  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'paid';
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  WHEN OTHERS THEN
    NULL;
  END;
  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'PAID';
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  WHEN OTHERS THEN
    NULL;
  END;
END $$;

-- 2. Update trigger function with explicit text casting
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
  -- Defensive conversion of status to text prevents enum comparison failures
  v_new_status := LOWER(COALESCE(NEW.status::text, ''));
  v_old_status := LOWER(COALESCE(OLD.status::text, ''));

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

    -- Update buyer stats (avg pay time)
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
        END
      WHERE id = v_buyer_id;
    END IF;

    -- Update seller stats (avg release time)
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
        END
      WHERE id = v_seller_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
