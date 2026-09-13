import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { DEFAULT_EXCHANGE_RATES } from '@/lib/currency';

export const dynamic = 'force-dynamic';

const BASE_CRYPTO_USD_PRICES: Record<string, number> = {
  USDT: 1.0,
  USDC: 1.0,
  BTC: 65000.0,
  ETH: 3500.0,
  LTC: 85.0,
  TRX: 0.15,
  SOL: 150.0,
  BNB: 580.0,
  DOGE: 0.12,
};

function generateFallbackPrices(targetAsset?: string, targetFiat?: string) {
  const fiat = targetFiat || 'USD';
  const fiatRate = DEFAULT_EXCHANGE_RATES[fiat] ?? 1;

  const assets = targetAsset ? [targetAsset] : Object.keys(BASE_CRYPTO_USD_PRICES);

  return assets.map((asset) => {
    const usdPrice = BASE_CRYPTO_USD_PRICES[asset] ?? 1.0;
    return {
      asset_symbol: asset,
      fiat_symbol: fiat,
      price_in_fiat: usdPrice * fiatRate,
      updated_at: new Date().toISOString(),
    };
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const asset = searchParams.get('asset')?.trim().toUpperCase();
  const fiat = searchParams.get('fiat')?.trim().toUpperCase() || 'USD';

  try {
    const supabaseAdmin = getSupabaseAdminClient();
    let query = supabaseAdmin
      .from('crypto_market_prices')
      .select('asset_symbol, fiat_symbol, price_in_fiat, updated_at');

    if (asset) {
      query = query.eq('asset_symbol', asset);
    }
    if (fiat) {
      query = query.eq('fiat_symbol', fiat);
    }

    const { data: prices, error } = await query;

    if (error || !prices || prices.length === 0) {
      const fallback = generateFallbackPrices(asset, fiat);
      return NextResponse.json({
        success: true,
        prices: fallback,
        source: 'fallback',
      });
    }

    return NextResponse.json({
      success: true,
      prices: prices,
      source: 'database',
    });
  } catch (err: any) {
    const fallback = generateFallbackPrices(asset, fiat);
    return NextResponse.json({
      success: true,
      prices: fallback,
      source: 'fallback',
    });
  }
}

