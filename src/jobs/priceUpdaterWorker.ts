import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const ASSETS = ['BTC', 'ETH', 'USDT', 'BNB', 'SOL', 'XRP', 'LTC', 'TRX'];

const COINGECKO_MAP: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  USDT: 'tether',
  BNB: 'binancecoin',
  SOL: 'solana',
  XRP: 'ripple',
  LTC: 'litecoin',
  TRX: 'tron',
};

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

async function safeFetchJson(url: string, timeoutMs: number = 8000) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      headers: COMMON_HEADERS,
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export interface PriceUpdateResult {
  success: boolean;
  live_crypto_assets?: number;
  total_fiats?: number;
  records_updated?: number;
  timestamp?: string;
  error?: string;
}

/**
 * Fetches live crypto prices and fiat rates from public market APIs
 * and upserts them into public.crypto_market_prices.
 */
export async function runMarketPriceUpdate(): Promise<PriceUpdateResult> {
  try {
    // 1. Fetch Live Global Fiat Rates from Live Providers
    let usdToFiat: Record<string, number> = {};

    // Primary Fiat Provider: Open Exchange Rates / ExchangeRate-API
    const fiatData = await safeFetchJson('https://open.er-api.com/v6/latest/USD');
    if (fiatData?.result === 'success' && fiatData.rates && typeof fiatData.rates === 'object') {
      for (const [code, rate] of Object.entries(fiatData.rates)) {
        const numRate = Number(rate);
        if (!isNaN(numRate) && isFinite(numRate) && numRate > 0) {
          usdToFiat[code.toUpperCase()] = numRate;
        }
      }
    }

    // Secondary Fiat Provider: Frankfurter (European Central Bank data)
    if (Object.keys(usdToFiat).length === 0) {
      const frankfurterData = await safeFetchJson('https://api.frankfurter.app/latest?from=USD');
      if (frankfurterData?.rates && typeof frankfurterData.rates === 'object') {
        usdToFiat.USD = 1.0;
        for (const [code, rate] of Object.entries(frankfurterData.rates)) {
          const numRate = Number(rate);
          if (!isNaN(numRate) && isFinite(numRate) && numRate > 0) {
            usdToFiat[code.toUpperCase()] = numRate;
          }
        }
      }
    }

    // Ensure USD base is 1.0 if not already present
    if (Object.keys(usdToFiat).length > 0 && !usdToFiat.USD) {
      usdToFiat.USD = 1.0;
    }

    if (Object.keys(usdToFiat).length === 0) {
      console.error('[Market Prices Worker] All live fiat providers failed to respond.');
      return { success: false, error: 'LIVE_FIAT_PROVIDER_UNAVAILABLE' };
    }

    // 2. Multi-Tier Live Crypto Price Resolution
    const cryptoUsdPrices: Record<string, number> = { USDT: 1.0 };

    // Tier 1: Binance Global Public Ticker
    const symbolList = ASSETS.filter((a) => a !== 'USDT').map((a) => `"${a}USDT"`);
    const encodedSymbols = encodeURIComponent(`[${symbolList.join(',')}]`);
    const binanceData = await safeFetchJson(`https://api.binance.com/api/v3/ticker/price?symbols=${encodedSymbols}`);

    if (Array.isArray(binanceData)) {
      binanceData.forEach((item: { symbol: string; price: string }) => {
        const coin = item.symbol.replace('USDT', '');
        const p = parseFloat(item.price);
        if (!isNaN(p) && isFinite(p) && p > 0) {
          cryptoUsdPrices[coin] = p;
        }
      });
    }

    // Tier 2: CoinGecko Live Simple Price Fallback for any missing assets
    const missingGeckoAssets = ASSETS.filter((a) => !cryptoUsdPrices[a]);
    if (missingGeckoAssets.length > 0) {
      const geckoIds = missingGeckoAssets.map((a) => COINGECKO_MAP[a]).filter(Boolean).join(',');
      if (geckoIds) {
        const cgData = await safeFetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${geckoIds}&vs_currencies=usd`);
        if (cgData && typeof cgData === 'object') {
          Object.entries(COINGECKO_MAP).forEach(([symbol, id]) => {
            const val = cgData[id]?.usd;
            const p = typeof val === 'number' ? val : parseFloat(val);
            if (!isNaN(p) && isFinite(p) && p > 0) {
              cryptoUsdPrices[symbol] = p;
            }
          });
        }
      }
    }

    const liveAssets = Object.keys(cryptoUsdPrices);
    if (liveAssets.length === 0) {
      console.error('[Market Prices Worker] All live crypto price providers failed.');
      return { success: false, error: 'LIVE_CRYPTO_PROVIDER_UNAVAILABLE' };
    }

    // 3. Generate Validated Market Price Matrix Across Live Fiats
    const now = new Date().toISOString();
    const upsertRows: Array<{
      asset_symbol: string;
      fiat_symbol: string;
      price_in_fiat: number;
      updated_at: string;
    }> = [];

    const ALL_FIATS = Object.keys(usdToFiat);

    for (const asset of liveAssets) {
      const usdPrice = cryptoUsdPrices[asset];
      if (!usdPrice || usdPrice <= 0 || isNaN(usdPrice)) continue;

      for (const fiat of ALL_FIATS) {
        const fiatRate = usdToFiat[fiat];
        if (fiatRate && fiatRate > 0 && isFinite(fiatRate)) {
          const calculatedPrice = usdPrice * fiatRate;

          if (isNaN(calculatedPrice) || !isFinite(calculatedPrice) || calculatedPrice <= 0) {
            continue;
          }

          let finalPrice: number;
          if (calculatedPrice >= 1e12) {
            finalPrice = Number(calculatedPrice.toFixed(2));
          } else if (calculatedPrice >= 1) {
            finalPrice = Number(calculatedPrice.toFixed(4));
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

    // Batch upsert to Supabase in chunks of 500
    const CHUNK_SIZE = 500;
    for (let i = 0; i < upsertRows.length; i += CHUNK_SIZE) {
      const chunk = upsertRows.slice(i, i + CHUNK_SIZE);
      const { error } = await supabaseAdmin
        .from('crypto_market_prices')
        .upsert(chunk, { onConflict: 'asset_symbol,fiat_symbol' });

      if (error) {
        console.error('[Market Prices Worker] DB Upsert error:', error);
        throw error;
      }
    }

    return {
      success: true,
      live_crypto_assets: liveAssets.length,
      total_fiats: ALL_FIATS.length,
      records_updated: upsertRows.length,
      timestamp: now,
    };
  } catch (err: any) {
    console.error('[Market Prices Worker] Execution error:', err?.message || err);
    return { success: false, error: err?.message || 'UNKNOWN_ERROR' };
  }
}
