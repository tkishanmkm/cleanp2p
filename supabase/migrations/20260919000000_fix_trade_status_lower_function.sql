-- ==============================================================================
-- Migration: 20260919000000_fix_trade_status_lower_function.sql
-- Purpose: 
-- 1. Create polymorphic lower(trade_status) overload to eliminate PostgreSQL Error 42883
--    ("function lower(trade_status) does not exist")
-- 2. Ensure all trade metrics & status triggers safely cast status to text
-- 3. Set minimum default payment window to 30 minutes
-- ==============================================================================

-- 1. Create polymorphic lower() function for trade_status enum
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'trade_status') THEN
    EXECUTE $func$
      CREATE OR REPLACE FUNCTION public.lower(t trade_status)
      RETURNS text
      LANGUAGE sql
      IMMUTABLE
      PARALLEL SAFE
      AS $body$
        SELECT lower(t::text);
      $body$;
    $func$;
  END IF;
END $$;

-- 2. Add missing enum values safely
DO $$
BEGIN
  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'pending';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'PENDING';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'paid';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'PAID';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'completed';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'COMPLETED';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'released';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'RELEASED';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'disputed';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'DISPUTED';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'cancelled';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER TYPE trade_status ADD VALUE IF NOT EXISTS 'CANCELLED';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

-- 3. Update fn_update_user_trade_metrics trigger function with strict text casting
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
        END,
        updated_at = NOW()
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

-- 4. Set minimum payment window in initiate_p2p_trade RPC to 30 minutes
CREATE OR REPLACE FUNCTION public.initiate_p2p_trade(
  p_ad_id UUID,
  p_buyer_id UUID,
  p_seller_id UUID,
  p_crypto_amount NUMERIC,
  p_crypto_symbol TEXT,
  p_rate NUMERIC,
  p_fiat_amount NUMERIC,
  p_fiat_currency TEXT,
  p_payment_method TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_computed RECORD;
  v_trade_id UUID;
  v_seller_balance NUMERIC;
  v_window_mins INT := 30;
BEGIN
  -- Validate user authentication
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Unauthorized trade initiation';
  END IF;

  -- Compute valid amounts
  SELECT * INTO v_computed FROM public.sanitize_and_compute_trade(p_crypto_amount, p_rate, p_fiat_amount);

  IF v_computed.computed_crypto <= 0 OR v_computed.computed_fiat <= 0 OR v_computed.computed_rate <= 0 THEN
    RAISE EXCEPTION 'Invalid trade calculation amounts';
  END IF;

  -- Check seller available balance
  SELECT available_balance INTO v_seller_balance
  FROM public.balances
  WHERE user_id = p_seller_id AND asset = UPPER(p_crypto_symbol)
  FOR UPDATE;

  IF v_seller_balance IS NULL OR v_seller_balance < (v_computed.computed_crypto + v_computed.escrow_fee) THEN
    RAISE EXCEPTION 'Seller has insufficient balance in escrow';
  END IF;

  -- Deduct from seller available balance and lock in escrow
  UPDATE public.balances
  SET available_balance = available_balance - (v_computed.computed_crypto + v_computed.escrow_fee),
      locked_balance = COALESCE(locked_balance, 0) + (v_computed.computed_crypto + v_computed.escrow_fee),
      updated_at = NOW()
  WHERE user_id = p_seller_id AND asset = UPPER(p_crypto_symbol);

  -- Insert Trade Record with 30 minute minimum window
  INSERT INTO public.trades (
    ad_id,
    buyer_id,
    seller_id,
    crypto,
    crypto_amount,
    amount,
    escrow_fee,
    fiat_currency,
    fiat_amount,
    total_fiat,
    rate,
    price,
    payment_method,
    status,
    payment_window_minutes,
    created_at,
    expires_at
  ) VALUES (
    p_ad_id,
    p_buyer_id,
    p_seller_id,
    UPPER(p_crypto_symbol),
    v_computed.computed_crypto,
    v_computed.computed_crypto,
    v_computed.escrow_fee,
    UPPER(p_fiat_currency),
    v_computed.computed_fiat,
    v_computed.computed_fiat,
    v_computed.computed_rate,
    v_computed.computed_rate,
    p_payment_method,
    'pending',
    v_window_mins,
    NOW(),
    NOW() + INTERVAL '30 minutes'
  ) RETURNING id INTO v_trade_id;

  RETURN jsonb_build_object(
    'success', true,
    'trade_id', v_trade_id,
    'crypto_amount', v_computed.computed_crypto,
    'fiat_amount', v_computed.computed_fiat,
    'rate', v_computed.computed_rate
  );
END;
$$;
