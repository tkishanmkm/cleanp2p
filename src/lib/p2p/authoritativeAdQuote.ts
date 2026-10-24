import { getSupabaseAdminClient } from '@/utils/supabase/server';

export interface AuthoritativeAdQuote {
  price: number;
  fiatCurrency: string;
}

/**
 * Resolve a quote from server-owned ad fields and canonical market data.
 * The escrow RPC independently repeats the calculation inside its transaction.
 */
export async function resolveAuthoritativeAdQuote(ad: Record<string, any>): Promise<AuthoritativeAdQuote | null> {
  const asset = String(ad.asset_symbol || ad.crypto_currency || ad.coin || ad.crypto || ad.asset || 'USDT').toUpperCase().trim();
  const fiatCurrency = String(ad.fiat_currency || ad.fiat_symbol || ad.fiat || ad.currency || 'USD').toUpperCase().trim();
  const pricingType = String(ad.pricing_type || ad.rate_type || '').toUpperCase();
  const isFixed = Boolean(ad.is_fixed) || pricingType === 'FIXED';
  const storedPrice = Number(ad.price ?? ad.unit_price ?? (typeof ad.fixed_rate === 'number' ? ad.fixed_rate : 0));

  if (isFixed) {
    if (!Number.isFinite(storedPrice) || storedPrice <= 0) return null;
    return { price: Number(storedPrice.toFixed(8)), fiatCurrency };
  }

  const margin = Number(ad.rate_percent ?? ad.margin ?? ad.margin_percentage ?? 0);
  if (!Number.isFinite(margin) || margin < -50 || margin > 50) return null;

  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from('crypto_market_prices')
    .select('price_in_fiat, updated_at')
    .eq('asset_symbol', asset)
    .eq('fiat_symbol', fiatCurrency)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  const marketPrice = Number(data.price_in_fiat);
  if (!Number.isFinite(marketPrice) || marketPrice <= 0) return null;

  const price = Number((marketPrice * (1 + margin / 100)).toFixed(8));
  return Number.isFinite(price) && price > 0 ? { price, fiatCurrency } : null;
}
