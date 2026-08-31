import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { supabase } from '@/lib/supabase/client';

export interface NetworkGasFee {
  id?: string;
  crypto: string;
  network: string;
  base_fee_gwei?: number | null;
  priority_fee_gwei?: number | null;
  sat_per_vbyte?: number | null;
  estimated_fee_native: number;
  estimated_fee_usd: number;
  updated_at: string;
}

// Fallback Crypto USD Price Estimates
const FALLBACK_CRYPTO_USD_PRICES: Record<string, number> = {
  BTC: 65000,
  ETH: 3500,
  USDT: 1.0,
  USDC: 1.0,
  TRX: 0.15,
  LTC: 85,
  SOL: 150,
  MATIC: 0.55,
  POLYGON: 0.55,
  BNB: 580,
  BSC: 580,
  ARBITRUM: 0.75,
};

/**
 * Helper to fetch live crypto USD price from CoinGecko or fallback.
 */
async function getAssetUsdPrice(cryptoCode: string): Promise<number> {
  const asset = cryptoCode.toUpperCase();
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${
        asset === 'BTC'
          ? 'bitcoin'
          : asset === 'ETH'
          ? 'ethereum'
          : asset === 'TRX'
          ? 'tron'
          : asset === 'LTC'
          ? 'litecoin'
          : asset === 'SOL'
          ? 'solana'
          : 'tether'
      }&vs_currencies=usd`,
      { next: { revalidate: 300 } }
    );
    if (res.ok) {
      const data = await res.json();
      const firstKey = Object.keys(data)[0];
      if (firstKey && data[firstKey]?.usd) {
        return Number(data[firstKey].usd);
      }
    }
  } catch {
    // Ignore and fallback
  }
  return FALLBACK_CRYPTO_USD_PRICES[asset] || 1.0;
}

/**
 * 1. Ethereum / EVM Gas Estimation
 */
async function estimateEvmGasFees(
  crypto: string,
  network: string
): Promise<NetworkGasFee> {
  let baseFeeGwei = 20;
  let priorityFeeGwei = 1.5;

  try {
    const res = await fetch('https://cloudflare-eth.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_gasPrice',
        params: [],
        id: 1,
      }),
      next: { revalidate: 30 },
    });

    if (res.ok) {
      const data = await res.json();
      if (data?.result) {
        const gasPriceWei = parseInt(data.result, 16);
        const gasPriceGwei = gasPriceWei / 1e9;
        baseFeeGwei = Math.max(gasPriceGwei * 0.85, 5);
        priorityFeeGwei = Math.max(gasPriceGwei * 0.15, 1);
      }
    }
  } catch {
    // Fallback to default gas estimates
  }

  const isErc20 = crypto === 'USDT' || crypto === 'USDC' || network === 'ERC20';
  const gasLimit = isErc20 ? 65000 : 21000;
  const totalGweiPerUnit = baseFeeGwei + priorityFeeGwei;
  const estimatedFeeNative = (totalGweiPerUnit * gasLimit) / 1e9;

  const ethPrice = await getAssetUsdPrice('ETH');
  const estimatedFeeUsd = estimatedFeeNative * ethPrice;

  return {
    crypto,
    network,
    base_fee_gwei: Number(baseFeeGwei.toFixed(2)),
    priority_fee_gwei: Number(priorityFeeGwei.toFixed(2)),
    sat_per_vbyte: null,
    estimated_fee_native: Number(estimatedFeeNative.toFixed(6)),
    estimated_fee_usd: Number(estimatedFeeUsd.toFixed(2)),
    updated_at: new Date().toISOString(),
  };
}

/**
 * 2. Bitcoin (BTC) Fee Estimation from Mempool.space
 */
async function estimateBtcGasFees(
  crypto: string,
  network: string
): Promise<NetworkGasFee> {
  let satPerVbyte = 15;

  try {
    const res = await fetch('https://mempool.space/api/v1/fees/recommended', {
      next: { revalidate: 60 },
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.halfHourFee) {
        satPerVbyte = data.halfHourFee;
      }
    }
  } catch {
    // Fallback
  }

  // Standard Native SegWit vB is approx 140 vBytes
  const estimatedSats = satPerVbyte * 140;
  const estimatedFeeNative = estimatedSats / 1e8;
  const btcPrice = await getAssetUsdPrice('BTC');
  const estimatedFeeUsd = estimatedFeeNative * btcPrice;

  return {
    crypto,
    network,
    base_fee_gwei: null,
    priority_fee_gwei: null,
    sat_per_vbyte: satPerVbyte,
    estimated_fee_native: Number(estimatedFeeNative.toFixed(8)),
    estimated_fee_usd: Number(estimatedFeeUsd.toFixed(2)),
    updated_at: new Date().toISOString(),
  };
}

/**
 * 3. Tron (TRC20 / TRX) Fee Estimation
 */
async function estimateTronGasFees(
  crypto: string,
  network: string
): Promise<NetworkGasFee> {
  const isTrc20 = crypto === 'USDT' || crypto === 'USDC' || network === 'TRC20';
  // USDT TRC20 transfer consumes ~32,000 Energy + 345 Bandwidth (~13.5 - 27 TRX)
  // Native TRX transfer consumes ~270 Bandwidth (~1.1 TRX)
  const estimatedFeeNative = isTrc20 ? 15.0 : 1.1;
  const trxPrice = await getAssetUsdPrice('TRX');
  const estimatedFeeUsd = estimatedFeeNative * trxPrice;

  return {
    crypto,
    network,
    base_fee_gwei: null,
    priority_fee_gwei: null,
    sat_per_vbyte: null,
    estimated_fee_native: Number(estimatedFeeNative.toFixed(4)),
    estimated_fee_usd: Number(estimatedFeeUsd.toFixed(2)),
    updated_at: new Date().toISOString(),
  };
}

/**
 * 4. Litecoin (LTC) Fee Estimation
 */
async function estimateLtcGasFees(
  crypto: string,
  network: string
): Promise<NetworkGasFee> {
  const satPerVbyte = 2;
  const estimatedSats = satPerVbyte * 140;
  const estimatedFeeNative = estimatedSats / 1e8;
  const ltcPrice = await getAssetUsdPrice('LTC');
  const estimatedFeeUsd = estimatedFeeNative * ltcPrice;

  return {
    crypto,
    network,
    base_fee_gwei: null,
    priority_fee_gwei: null,
    sat_per_vbyte: satPerVbyte,
    estimated_fee_native: Number(estimatedFeeNative.toFixed(8)),
    estimated_fee_usd: Number(estimatedFeeUsd.toFixed(2)),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Queries all supported networks and upserts cached live gas fees into network_gas_fees table.
 */
export async function fetchAndCacheNetworkGasFees(): Promise<NetworkGasFee[]> {
  const networksToQuery = [
    { crypto: 'BTC', network: 'BTC' },
    { crypto: 'ETH', network: 'ETH' },
    { crypto: 'USDT', network: 'ERC20' },
    { crypto: 'USDC', network: 'ERC20' },
    { crypto: 'USDT', network: 'TRC20' },
    { crypto: 'TRX', network: 'TRX' },
    { crypto: 'LTC', network: 'LTC' },
  ];

  const results: NetworkGasFee[] = [];

  for (const item of networksToQuery) {
    try {
      let feeMetric: NetworkGasFee;
      if (item.network === 'BTC' || item.crypto === 'BTC') {
        feeMetric = await estimateBtcGasFees(item.crypto, item.network);
      } else if (item.network === 'TRC20' || item.network === 'TRX') {
        feeMetric = await estimateTronGasFees(item.crypto, item.network);
      } else if (item.network === 'LTC' || item.crypto === 'LTC') {
        feeMetric = await estimateLtcGasFees(item.crypto, item.network);
      } else {
        feeMetric = await estimateEvmGasFees(item.crypto, item.network);
      }

      results.push(feeMetric);
    } catch (err) {
      console.error(`Failed to estimate gas fee for ${item.crypto}/${item.network}:`, err);
    }
  }

  // Upsert to Supabase Admin Client
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    for (const record of results) {
      const id = `${record.crypto.toLowerCase()}_${record.network.toLowerCase()}`;
      await supabaseAdmin.from('network_gas_fees').upsert(
        {
          id,
          crypto: record.crypto,
          network: record.network,
          base_fee_gwei: record.base_fee_gwei,
          priority_fee_gwei: record.priority_fee_gwei,
          sat_per_vbyte: record.sat_per_vbyte,
          estimated_fee_native: record.estimated_fee_native,
          estimated_fee_usd: record.estimated_fee_usd,
          updated_at: record.updated_at,
        },
        { onConflict: 'id' }
      );
    }
  } catch (dbErr) {
    console.error('Failed to upsert network_gas_fees:', dbErr);
  }

  return results;
}

/**
 * Fetches cached gas fee for a specific crypto and network from Supabase.
 */
export async function getCachedGasFees(
  cryptoCode: string,
  networkCode: string
): Promise<NetworkGasFee | null> {
  const asset = cryptoCode.toUpperCase();
  const net = networkCode.toUpperCase();
  const id = `${asset.toLowerCase()}_${net.toLowerCase()}`;

  try {
    const { data, error } = await supabase
      .from('network_gas_fees')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (!error && data) {
      return data as NetworkGasFee;
    }
  } catch {
    // Fallback to live on-demand calculation if table record not yet seeded
  }

  // Dynamic on-demand fallback calculation
  if (net === 'BTC' || asset === 'BTC') {
    return estimateBtcGasFees(asset, net);
  } else if (net === 'TRC20' || net === 'TRX') {
    return estimateTronGasFees(asset, net);
  } else if (net === 'LTC' || asset === 'LTC') {
    return estimateLtcGasFees(asset, net);
  } else {
    return estimateEvmGasFees(asset, net);
  }
}
