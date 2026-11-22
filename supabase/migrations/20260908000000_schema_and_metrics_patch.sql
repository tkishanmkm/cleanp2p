-- ==============================================================================
-- Supabase Migration: Schema, Metrics, and Field Alignment Patch
-- Purpose: 
--   1. Add missing/aliased columns safely with IF NOT EXISTS across profiles, p2p_ads, and trades.
--   2. Ensure consistency between primary keys (id vs public_id / public_ad_id).
--   3. Implement robust trigger functions with defensive NULL handling for average trade metrics.
-- ==============================================================================

-- 1. PROFILES TABLE AUDIT & ALIGNMENT
ALTER TABLE IF EXISTS public.profiles
  ADD COLUMN IF NOT EXISTS avg_payment_time_mins NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_payment_minutes NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_pay_time NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_release_time_mins NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_release_minutes NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_release_time NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_completed_trades INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_trades INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_trade_volume NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS positive_feedback INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS negative_feedback INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS feedback_score NUMERIC DEFAULT 100,
  ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_active TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS photo_url TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- 2. P2P_ADS TABLE AUDIT & ALIGNMENT
ALTER TABLE IF EXISTS public.p2p_ads
  ADD COLUMN IF NOT EXISTS public_ad_id TEXT,
  ADD COLUMN IF NOT EXISTS public_id TEXT,
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC,
  ADD COLUMN IF NOT EXISTS price NUMERIC,
  ADD COLUMN IF NOT EXISTS fixed_rate NUMERIC,
  ADD COLUMN IF NOT EXISTS rate_percent NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_margin NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_margin_percent NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rate_type TEXT DEFAULT 'market',
  ADD COLUMN IF NOT EXISTS pricing_type TEXT DEFAULT 'FLOAT',
  ADD COLUMN IF NOT EXISTS payment_window_minutes INTEGER DEFAULT 30,
  ADD COLUMN IF NOT EXISTS payment_window INTEGER DEFAULT 30,
  ADD COLUMN IF NOT EXISTS payment_time_limit INTEGER DEFAULT 30,
  ADD COLUMN IF NOT EXISTS min_amount NUMERIC DEFAULT 10,
  ADD COLUMN IF NOT EXISTS max_amount NUMERIC DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS min_limit NUMERIC DEFAULT 10,
  ADD COLUMN IF NOT EXISTS max_limit NUMERIC DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS available_amount NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS available_balance NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_methods JSONB DEFAULT '["Bank Transfer"]'::jsonb,
  ADD COLUMN IF NOT EXISTS terms_conditions TEXT,
  ADD COLUMN IF NOT EXISTS offer_tags JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;

-- Ensure public_ad_id is populated for existing ads if null
UPDATE public.p2p_ads
SET public_ad_id = COALESCE(public_ad_id, public_id, id::text)
WHERE public_ad_id IS NULL;

-- 3. TRADES TABLE AUDIT & ALIGNMENT
ALTER TABLE IF EXISTS public.trades
  ADD COLUMN IF NOT EXISTS public_id TEXT,
  ADD COLUMN IF NOT EXISTS trade_id TEXT,
  ADD COLUMN IF NOT EXISTS ad_id UUID,
  ADD COLUMN IF NOT EXISTS buyer_id UUID,
  ADD COLUMN IF NOT EXISTS seller_id UUID,
  ADD COLUMN IF NOT EXISTS crypto_amount NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fiat_amount NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS asset_symbol TEXT DEFAULT 'BTC',
  ADD COLUMN IF NOT EXISTS crypto_currency TEXT DEFAULT 'BTC',
  ADD COLUMN IF NOT EXISTS fiat_currency TEXT DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS payment_window_minutes INTEGER DEFAULT 30,
  ADD COLUMN IF NOT EXISTS payment_time_limit INTEGER DEFAULT 30,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disputed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Ensure public_id is populated for existing trades if null
UPDATE public.trades
SET public_id = COALESCE(public_id, trade_id, id::text)
WHERE public_id IS NULL;

-- 4. DISPUTES TABLE AUDIT & ALIGNMENT
CREATE TABLE IF NOT EXISTS public.disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID REFERENCES public.trades(id) ON DELETE CASCADE,
  opened_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason TEXT,
  explanation TEXT,
  status TEXT DEFAULT 'open',
  resolution TEXT,
  resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_p2p_ads_public_ad_id ON public.p2p_ads(public_ad_id);
CREATE INDEX IF NOT EXISTS idx_p2p_ads_user_id ON public.p2p_ads(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_public_id ON public.trades(public_id);
CREATE INDEX IF NOT EXISTS idx_trades_buyer_id ON public.trades(buyer_id);
CREATE INDEX IF NOT EXISTS idx_trades_seller_id ON public.trades(seller_id);
CREATE INDEX IF NOT EXISTS idx_trades_status ON public.trades(status);
CREATE INDEX IF NOT EXISTS idx_disputes_trade_id ON public.disputes(trade_id);

-- 6. DEFENSIVE METRICS TRIGGER FUNCTION
-- Automatically updates avg pay time, avg release time, and completed trade count upon trade release
CREATE OR REPLACE FUNCTION public.fn_update_user_trade_metrics()
RETURNS TRIGGER AS $$
DECLARE
  v_buyer_id UUID;
  v_seller_id UUID;
  v_pay_duration_mins NUMERIC;
  v_release_duration_mins NUMERIC;
BEGIN
  -- Only execute when a trade reaches 'completed' or 'released' status
  IF (NEW.status IN ('completed', 'released') AND (OLD.status IS NULL OR OLD.status NOT IN ('completed', 'released'))) THEN
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

    -- Update Buyer's completed trades & average payment time
    IF v_buyer_id IS NOT NULL THEN
      UPDATE public.profiles
      SET 
        completed_trades = COALESCE(completed_trades, 0) + 1,
        total_completed_trades = COALESCE(total_completed_trades, 0) + 1,
        total_trade_volume = COALESCE(total_trade_volume, 0) + COALESCE(NEW.fiat_amount, 0),
        avg_payment_minutes = CASE 
          WHEN v_pay_duration_mins IS NOT NULL AND COALESCE(completed_trades, 0) > 0 
            THEN ROUND(((COALESCE(avg_payment_minutes, 0) * completed_trades + v_pay_duration_mins) / (completed_trades + 1))::numeric, 2)
          WHEN v_pay_duration_mins IS NOT NULL 
            THEN ROUND(v_pay_duration_mins::numeric, 2)
          ELSE COALESCE(avg_payment_minutes, 0)
        END,
        avg_payment_time_mins = CASE 
          WHEN v_pay_duration_mins IS NOT NULL AND COALESCE(total_completed_trades, 0) > 0 
            THEN ROUND(((COALESCE(avg_payment_time_mins, 0) * total_completed_trades + v_pay_duration_mins) / (total_completed_trades + 1))::numeric, 2)
          WHEN v_pay_duration_mins IS NOT NULL 
            THEN ROUND(v_pay_duration_mins::numeric, 2)
          ELSE COALESCE(avg_payment_time_mins, 0)
        END,
        avg_pay_time = CASE 
          WHEN v_pay_duration_mins IS NOT NULL AND COALESCE(completed_trades, 0) > 0 
            THEN ROUND(((COALESCE(avg_pay_time, 0) * completed_trades + v_pay_duration_mins) / (completed_trades + 1))::numeric, 2)
          WHEN v_pay_duration_mins IS NOT NULL 
            THEN ROUND(v_pay_duration_mins::numeric, 2)
          ELSE COALESCE(avg_pay_time, 0)
        END,
        updated_at = now()
      WHERE id = v_buyer_id;
    END IF;

    -- Update Seller's completed trades & average release time
    IF v_seller_id IS NOT NULL THEN
      UPDATE public.profiles
      SET 
        completed_trades = COALESCE(completed_trades, 0) + 1,
        total_completed_trades = COALESCE(total_completed_trades, 0) + 1,
        total_trade_volume = COALESCE(total_trade_volume, 0) + COALESCE(NEW.fiat_amount, 0),
        avg_release_minutes = CASE 
          WHEN v_release_duration_mins IS NOT NULL AND COALESCE(completed_trades, 0) > 0 
            THEN ROUND(((COALESCE(avg_release_minutes, 0) * completed_trades + v_release_duration_mins) / (completed_trades + 1))::numeric, 2)
          WHEN v_release_duration_mins IS NOT NULL 
            THEN ROUND(v_release_duration_mins::numeric, 2)
          ELSE COALESCE(avg_release_minutes, 0)
        END,
        avg_release_time_mins = CASE 
          WHEN v_release_duration_mins IS NOT NULL AND COALESCE(total_completed_trades, 0) > 0 
            THEN ROUND(((COALESCE(avg_release_time_mins, 0) * total_completed_trades + v_release_duration_mins) / (total_completed_trades + 1))::numeric, 2)
          WHEN v_release_duration_mins IS NOT NULL 
            THEN ROUND(v_release_duration_mins::numeric, 2)
          ELSE COALESCE(avg_release_time_mins, 0)
        END,
        avg_release_time = CASE 
          WHEN v_release_duration_mins IS NOT NULL AND COALESCE(completed_trades, 0) > 0 
            THEN ROUND(((COALESCE(avg_release_time, 0) * completed_trades + v_release_duration_mins) / (completed_trades + 1))::numeric, 2)
          WHEN v_release_duration_mins IS NOT NULL 
            THEN ROUND(v_release_duration_mins::numeric, 2)
          ELSE COALESCE(avg_release_time, 0)
        END,
        updated_at = now()
      WHERE id = v_seller_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger idempotently
DROP TRIGGER IF EXISTS trg_update_user_trade_metrics ON public.trades;
CREATE TRIGGER trg_update_user_trade_metrics
AFTER UPDATE OF status ON public.trades
FOR EACH ROW
EXECUTE FUNCTION public.fn_update_user_trade_metrics();
