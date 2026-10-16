-- Restore the canonical advertisements relation before the trade RPC references it.
-- This migration captures the schema observed on the connected Supabase project.
BEGIN;

CREATE OR REPLACE FUNCTION public.generate_12_char_id()
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  chars TEXT := 'abcdefghijklmnopqrstuvwxyz0123456789';
  result TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..12 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$function$;

CREATE TABLE IF NOT EXISTS public.ads (
  id text PRIMARY KEY DEFAULT public.generate_12_char_id() CHECK (id ~ '^[a-z0-9]{12}$'),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type varchar NOT NULL CHECK (type::text = ANY (ARRAY['BUY'::varchar, 'SELL'::varchar]::text[])),
  asset_symbol varchar NOT NULL DEFAULT 'USDT',
  fiat_symbol varchar NOT NULL DEFAULT 'USD',
  price numeric NOT NULL CHECK (price > 0),
  total_amount numeric DEFAULT 0 CHECK (total_amount >= 0),
  min_limit numeric NOT NULL CHECK (min_limit >= 0),
  max_limit numeric NOT NULL,
  payment_methods text[] DEFAULT '{}'::text[],
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  ad_tags text[] DEFAULT '{}'::text[],
  tags text[] DEFAULT '{}'::text[],
  terms text DEFAULT '',
  auto_reply text DEFAULT '',
  blocked_countries text[] DEFAULT '{}'::text[],
  targeted_countries text[] DEFAULT '{}'::text[],
  min_completed_trades integer DEFAULT 0,
  offer_label text DEFAULT '',
  require_full_name_verified boolean DEFAULT false,
  require_verified_users boolean DEFAULT false,
  is_fixed boolean DEFAULT true,
  fixed_rate numeric DEFAULT 0,
  pricing_type text DEFAULT 'fixed',
  price_type text DEFAULT 'fixed',
  rate_type text DEFAULT 'fixed',
  margin numeric DEFAULT 0,
  margin_percentage numeric DEFAULT 0,
  rate_percent numeric DEFAULT 0,
  rate_adjustment numeric DEFAULT 0,
  payment_window integer DEFAULT 15,
  trade_type text,
  public_id text UNIQUE,
  public_ad_id text,
  unit_price numeric,
  price_margin numeric DEFAULT 0,
  payment_window_minutes integer DEFAULT 30,
  active boolean DEFAULT true,
  asset text,
  allowed_countries text[] DEFAULT '{}'::text[],
  remarks text,
  country_code text DEFAULT 'GLOBAL',
  payment_time_limit integer DEFAULT 30,
  coin text,
  token_symbol text,
  crypto_currency text,
  fiat_currency text DEFAULT 'INR',
  currency text,
  margin_rate numeric DEFAULT 0,
  fixed_price numeric,
  available_amount numeric,
  surplus_amount numeric,
  min_amount numeric,
  max_amount numeric,
  min_trade_count integer DEFAULT 0,
  label text,
  require_kyc boolean DEFAULT false,
  require_email_verified boolean DEFAULT false,
  require_phone_verified boolean DEFAULT false,
  status varchar DEFAULT 'active',
  min_trade_limit_usd numeric DEFAULT 10.00,
  is_deleted boolean DEFAULT false
);

ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access for ads" ON public.ads;
CREATE POLICY "Allow public read access for ads"
  ON public.ads FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Authenticated users can create own ads" ON public.ads;
CREATE POLICY "Authenticated users can create own ads"
  ON public.ads FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

GRANT SELECT ON public.ads TO anon, authenticated;
GRANT INSERT ON public.ads TO authenticated;

COMMIT;
