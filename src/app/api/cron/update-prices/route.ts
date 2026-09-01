import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key'
);

const ASSETS = ['BTC', 'ETH', 'USDT', 'BNB', 'SOL', 'XRP', 'LTC'];

// Emergency static baseline in case external network fails
const EMERGENCY_USD_BASELINES: Record<string, number> = {
  BTC: 79100,
  ETH: 2650,
  USDT: 1.0,
  BNB: 580,
  SOL: 145,
  XRP: 0.55,
  LTC: 68.50,
};

const COINGECKO_MAP: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  USDT: 'tether',
  BNB: 'binancecoin',
  SOL: 'solana',
  XRP: 'ripple',
  LTC: 'litecoin',
};

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

async function safeFetchJson(url: string) {
  try {
    const res = await fetch(url, { headers: COMMON_HEADERS, cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    // 1. Authorization Verification
    const { searchParams } = new URL(request.url);
    const authHeader = request.headers.get('authorization');
    const secretKey = searchParams.get('key') || authHeader?.replace('Bearer ', '');

    if (process.env.CRON_SECRET_KEY && secretKey !== process.env.CRON_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized request' }, { status: 401 });
    }

    // 2. Fetch ALL Available Global Fiat Rates Dynamic Key Lookup
    let usdToFiat: Record<string, number> = { USD: 1.0, EUR: 0.92, INR: 87.5, GBP: 0.78, BRL: 5.6, JPY: 155.2 };
    const fiatData = await safeFetchJson('https://open.er-api.com/v6/latest/USD');
    if (fiatData?.rates) {
      usdToFiat = { ...usdToFiat, ...fiatData.rates };
    }

    // Extract all dynamic fiat currency codes (USD, EUR, INR, AFN, ALL, etc.)
    const ALL_FIATS = Object.keys(usdToFiat);

    // 3. Multi-Tier Crypto Price Resolution
    const cryptoUsdPrices: Record<string, number> = { USDT: 1.0 };

    // Tier 1: Binance Global
    const symbolList = ASSETS.filter((a) => a !== 'USDT').map((a) => `"${a}USDT"`);
    const encodedSymbols = encodeURIComponent(`[${symbolList.join(',')}]`);
    const binanceData = await safeFetchJson(`https://api.binance.com/api/v3/ticker/price?symbols=${encodedSymbols}`);

    if (Array.isArray(binanceData)) {
      binanceData.forEach((item: { symbol: string; price: string }) => {
        const coin = item.symbol.replace('USDT', '');
        cryptoUsdPrices[coin] = parseFloat(item.price);
      });
    }

    // Tier 2: CoinGecko Fallback
    const missingGeckoAssets = ASSETS.filter((a) => !cryptoUsdPrices[a]);
    if (missingGeckoAssets.length > 0) {
      const geckoIds = missingGeckoAssets.map((a) => COINGECKO_MAP[a]).filter(Boolean).join(',');
      if (geckoIds) {
        const cgData = await safeFetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${geckoIds}&vs_currencies=usd`);
        if (cgData) {
          Object.entries(COINGECKO_MAP).forEach(([symbol, id]) => {
            if (cgData[id]?.usd) cryptoUsdPrices[symbol] = cgData[id].usd;
          });
        }
      }
    }

    // Tier 3: Emergency Fallbacks
    ASSETS.forEach((asset) => {
      if (!cryptoUsdPrices[asset]) {
        cryptoUsdPrices[asset] = EMERGENCY_USD_BASELINES[asset] || 1.0;
      }
    });

    // 4. Generate Full Matrix Across ALL Global Fiats
    const now = new Date().toISOString();
    const upsertRows: Array<{
      asset_symbol: string;
      fiat_symbol: string;
      price_in_fiat: number;
      updated_at: string;
    }> = [];

    for (const asset of ASSETS) {
      const usdPrice = cryptoUsdPrices[asset];
      for (const fiat of ALL_FIATS) {
        const fiatRate = usdToFiat[fiat];
        if (fiatRate && fiatRate > 0) {
          const calculatedPrice = usdPrice * fiatRate;

          // Prevent PostgreSQL NUMERIC overflow by capping maximum digits
          // or using appropriate rounding depending on total magnitude
          let finalPrice: number;
          if (calculatedPrice >= 1e12) {
            // High currency values (e.g., IRR/VND) don't need 8 decimal places
            finalPrice = Number(calculatedPrice.toFixed(2));
          } else {
            finalPrice = Number(calculatedPrice.toFixed(8));
          }

          upsertRows.push({
            asset_symbol: asset,
            fiat_symbol: fiat.toUpperCase(),
            price_in_fiat: finalPrice,
            updated_at: now,
          });
        }
      }
    }

    // Batch upsert to Supabase in chunks of 500 to prevent payload size limits
    const CHUNK_SIZE = 500;
    for (let i = 0; i < upsertRows.length; i += CHUNK_SIZE) {
      const chunk = upsertRows.slice(i, i + CHUNK_SIZE);
      const { error } = await supabaseAdmin
        .from('crypto_market_prices')
        .upsert(chunk, { onConflict: 'asset_symbol,fiat_symbol' });

      if (error) throw error;
    }

    return NextResponse.json({
      success: true,
      total_fiats: ALL_FIATS.length,
      records_updated: upsertRows.length,
      timestamp: now,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
