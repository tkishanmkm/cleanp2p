import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { getCachedGasFees } from '@/lib/gas-oracle';

/**
 * Authoritative Production Cryptocurrency Pricing & Dynamic Gas Fee Resolution Engine
 * 
 * Rules:
 * 1. User Withdrawal Fee = Multiplier × Applicable Blockchain Gas/Network Fee
 * 2. Default Multiplier = 2.0x (Configured in public.platform_settings.withdrawal_fee_multiplier)
 * 3. NO 1.5% platform fee.
 * 4. NO arbitrary fixed user fees.
 * 5. Client-provided fee values are strictly ignored.
 * 
 * Supported Production Networks ONLY:
 * - USDT TRC20 (TRON Mainnet)
 * - USDT ERC20 (Ethereum Mainnet)
 * - USDT BEP20 (BNB Smart Chain Mainnet)
 * - BTC (Bitcoin Mainnet)
 * - ETH (Ethereum Mainnet)
 * - LTC (Litecoin Mainnet)
 */

export interface AuthoritativeFeeResult {
  feeCrypto: number;
  feeUsd: number;
  baseNetworkFeeCrypto: number;
  multiplier: number;
}

/**
 * Retrieves authoritative real-time USD exchange price for supported cryptocurrencies.
 * Priority:
 * 1. Live crypto_market_prices table in database
 * 2. Live CoinGecko ticker API
 * 3. Live Binance ticker API
 */
export async function getAuthoritativeAssetUsdPrice(cryptoCode: string): Promise<number> {
  const asset = (cryptoCode || 'USDT').toUpperCase().trim();
  if (asset === 'USDT' || asset === 'USDC') {
    return 1.0;
  }

  // 1. Try querying latest price from database
  try {
    const admin = getSupabaseAdminClient();
    const { data } = await admin
      .from('crypto_market_prices')
      .select('price_in_fiat')
      .eq('asset_symbol', asset)
      .eq('fiat_symbol', 'USD')
      .maybeSingle();

    if (data && typeof data.price_in_fiat === 'number' && data.price_in_fiat > 0) {
      return data.price_in_fiat;
    }
  } catch {
    // Continue to live API
  }

  // 2. Try live CoinGecko API
  try {
    const coinGeckoId =
      asset === 'BTC' ? 'bitcoin' :
      asset === 'ETH' ? 'ethereum' :
      asset === 'TRX' ? 'tron' :
      asset === 'BNB' ? 'binancecoin' :
      asset === 'LTC' ? 'litecoin' : 'tether';

    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinGeckoId}&vs_currencies=usd`,
      { next: { revalidate: 60 } }
    );

    if (res.ok) {
      const data = await res.json();
      if (data && data[coinGeckoId]?.usd) {
        const p = Number(data[coinGeckoId].usd);
        if (!isNaN(p) && p > 0) return p;
      }
    }
  } catch {
    // Continue to live Binance
  }

  // 3. Try live Binance API
  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${asset}USDT`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.price) {
        const p = parseFloat(data.price);
        if (!isNaN(p) && p > 0) return p;
      }
    }
  } catch {}

  // Default fallback if unavailable
  return 1.0;
}

/**
 * Calculates authoritative USD equivalent of a given crypto asset amount
 */
export async function calculateWithdrawalUsdEquivalent(asset: string, amount: number): Promise<number> {
  const normAsset = (asset || 'USDT').toUpperCase().trim();
  const price = await getAuthoritativeAssetUsdPrice(normAsset);
  return Number((amount * price).toFixed(2));
}

/**
 * Fetches admin-configured withdrawal fee multiplier from platform_settings
 */
export async function getAdminFeeMultiplier(): Promise<number> {
  try {
    const admin = getSupabaseAdminClient();
    const { data: settings } = await admin
      .from('platform_settings')
      .select('withdrawal_fee_multiplier')
      .eq('id', 1)
      .maybeSingle();

    if (settings?.withdrawal_fee_multiplier) {
      const multiplier = Number(settings.withdrawal_fee_multiplier);
      if (!isNaN(multiplier) && multiplier > 0) {
        return multiplier;
      }
    }
  } catch {
    // Default fallback
  }
  return 2.0;
}

/**
 * Resolves server-authoritative withdrawal fee:
 * Formula: WITHDRAWAL FEE = Multiplier × (Actual Network Gas/Blockchain Fee)
 * 
 * Client-submitted fees are completely ignored.
 */
export async function resolveAuthoritativeWithdrawalFee(
  asset: string,
  network: string,
  explicitMultiplier?: number
): Promise<AuthoritativeFeeResult> {
  const normAsset = (asset || 'USDT').toUpperCase().trim();
  const normNet = (network || '').toUpperCase().trim();

  const multiplier = explicitMultiplier !== undefined && explicitMultiplier > 0
    ? explicitMultiplier
    : await getAdminFeeMultiplier();

  // 1. Fetch live or cached gas fee metrics from the gas oracle
  const gasMetric = await getCachedGasFees(normAsset, normNet);
  const assetPrice = await getAuthoritativeAssetUsdPrice(normAsset);

  let baseNetworkFeeCrypto = 0;

  if (gasMetric && gasMetric.estimated_fee_native > 0) {
    if (normAsset === 'USDT') {
      // For token withdrawals, convert native gas expense to USDT units
      // E.g., TRC20 consumes TRX, ERC20 consumes ETH, BEP20 consumes BNB
      const feeUsd = gasMetric.estimated_fee_usd || 1.5;
      baseNetworkFeeCrypto = feeUsd; // 1 USDT = $1 USD
    } else {
      baseNetworkFeeCrypto = gasMetric.estimated_fee_native;
    }
  } else {
    // Canonical baseline gas costs per network if oracle unreachable
    if (normNet === 'TRC20' || normNet === 'TRON') {
      baseNetworkFeeCrypto = 2.0; // ~13.5 TRX gas
    } else if (normNet === 'BEP20' || normNet === 'BSC' || normNet === 'BINANCE') {
      baseNetworkFeeCrypto = 0.5; // ~0.0008 BNB gas
    } else if (normNet === 'ERC20' || normNet === 'ETH' || normNet === 'ETHEREUM') {
      baseNetworkFeeCrypto = normAsset === 'USDT' ? 4.0 : 0.0008; // ~21,000-65,000 gas
    } else if (normNet === 'BTC' || normAsset === 'BTC') {
      baseNetworkFeeCrypto = 0.000035; // ~140 vB * 25 sat/vB
    } else if (normNet === 'LTC' || normAsset === 'LTC') {
      baseNetworkFeeCrypto = 0.000005; // ~140 vB * 3 lit/vB
    }
  }

  // Multiply applicable network gas fee by server multiplier (Default: 2.0X)
  const feeCrypto = Number((baseNetworkFeeCrypto * multiplier).toFixed(8));
  const feeUsd = Number((feeCrypto * assetPrice).toFixed(2));

  return {
    feeCrypto,
    feeUsd,
    baseNetworkFeeCrypto,
    multiplier,
  };
}

/**
 * Backward compatibility synchronous resolver (uses 2.0x standard gas derivation)
 */
export function resolveWithdrawalFee(
  asset: string,
  network?: string,
  _ignoredClientFee?: number | null
): number {
  const normAsset = (asset || 'USDT').toUpperCase().trim();
  const normNet = (network || '').toUpperCase().trim();
  const multiplier = 2.0;

  if (normAsset === 'USDT') {
    if (normNet === 'TRC20' || normNet === 'TRON') return Number((2.0 * multiplier).toFixed(4)); // 4.0 USDT
    if (normNet === 'BEP20' || normNet === 'BSC' || normNet === 'BINANCE') return Number((0.5 * multiplier).toFixed(4)); // 1.0 USDT
    return Number((4.0 * multiplier).toFixed(4)); // 8.0 USDT for ERC20
  }

  if (normAsset === 'ETH') return Number((0.0006 * multiplier).toFixed(6)); // 0.0012 ETH
  if (normAsset === 'BTC') return Number((0.000035 * multiplier).toFixed(8)); // 0.000070 BTC
  if (normAsset === 'LTC') return Number((0.000005 * multiplier).toFixed(8)); // 0.000010 LTC

  return 0;
}

export function getWithdrawalFeeConfig(asset: string, network?: string) {
  const feeCrypto = resolveWithdrawalFee(asset, network);
  const minWithdrawal = asset === 'BTC' ? 0.0002 : asset === 'ETH' ? 0.002 : asset === 'LTC' ? 0.01 : 5.0;
  return {
    feeCrypto,
    feeUsd: feeCrypto,
    minWithdrawal,
  };
}
