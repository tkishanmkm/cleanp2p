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

/**
 * Helper to fetch live crypto USD price from database or live market providers.
 */
async function getAssetUsdPrice(cryptoCode: string): Promise<number> {
  const asset = cryptoCode.toUpperCase();
  if (asset === 'USDT' || asset === 'USDC') {
    return 1.0;
  }

  // 1. Check live crypto_market_prices table in database
  try {
    const { getBrowserClient } = await import('@/lib/supabaseClient');
    const browserSupabase = getBrowserClient();
    const { data } = await browserSupabase
      .from('crypto_market_prices')
      .select('price_in_fiat, updated_at')
      .eq('asset_symbol', asset)
      .eq('fiat_symbol', 'USD')
      .maybeSingle();

    const price = Number(data?.price_in_fiat);
    const updatedAt = data?.updated_at ? Date.parse(data.updated_at) : NaN;
    const ageMs = Date.now() - updatedAt;
    if (Number.isFinite(price) && price > 0 && Number.isFinite(updatedAt) && ageMs >= -60_000 && ageMs <= 10 * 60_000) {
      return price;
    }
  } catch {}

  // 2. Live CoinGecko fetch
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
          : asset === 'BNB' || asset === 'BSC'
          ? 'binancecoin'
          : 'tether'
      }&vs_currencies=usd`,
      { next: { revalidate: 300 } }
    );
    if (res.ok) {
      const data = await res.json();
      const firstKey = Object.keys(data)[0];
      if (firstKey && data[firstKey]?.usd) {
        const p = Number(data[firstKey].usd);
        if (!isNaN(p) && p > 0) return p;
      }
    }
  } catch {}

  // 3. Live Binance fetch
  try {
    const binanceSymbol = asset === 'BSC' ? 'BNBUSDT' : `${asset}USDT`;
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.price) {
        const p = parseFloat(data.price);
        if (!isNaN(p) && p > 0) return p;
      }
    }
  } catch {}

  // Never substitute a $1 price for a volatile asset when every price
  // provider failed: that can materially understate or distort fee quotes.
  throw new Error(`Unable to determine a reliable USD price for ${asset}.`);
}

/**
 * 1. Ethereum / EVM & BSC Gas Estimation
 */
async function estimateEvmGasFees(
  crypto: string,
  network: string
): Promise<NetworkGasFee> {
  const isBsc = network.toUpperCase() === 'BEP20' || network.toUpperCase() === 'BSC' || crypto.toUpperCase() === 'BNB';
  const rpcUrl = isBsc ? 'https://binance.llamarpc.com' : 'https://cloudflare-eth.com';
  
  let baseFeeGwei = isBsc ? 3 : 15;
  let priorityFeeGwei = isBsc ? 1 : 1.5;

  try {
    const res = await fetch(rpcUrl, {
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
        if (isBsc) {
          baseFeeGwei = Math.max(gasPriceGwei * 0.9, 1);
          priorityFeeGwei = Math.max(gasPriceGwei * 0.1, 0.5);
        } else {
          baseFeeGwei = Math.max(gasPriceGwei * 0.85, 3);
          priorityFeeGwei = Math.max(gasPriceGwei * 0.15, 1);
        }
      }
    }
  } catch {
    // Fallback to default gas estimates
  }

  const isToken = crypto === 'USDT' || crypto === 'USDC' || network === 'ERC20' || network === 'BEP20';
  const gasLimit = isToken ? (isBsc ? 45000 : 65000) : 21000;
  
  // Apply 2.0X priority multiplier to guarantee instant mempool inclusion
  const totalGweiPerUnit = (baseFeeGwei + priorityFeeGwei) * 2.0;
  const estimatedFeeNative = (totalGweiPerUnit * gasLimit) / 1e9;

  const nativeAssetPrice = isBsc ? await getAssetUsdPrice('BNB') : await getAssetUsdPrice('ETH');
  const estimatedFeeUsd = estimatedFeeNative * nativeAssetPrice;

  return {
    crypto,
    network,
    base_fee_gwei: Number((baseFeeGwei * 2.0).toFixed(2)),
    priority_fee_gwei: Number((priorityFeeGwei * 2.0).toFixed(2)),
    sat_per_vbyte: null,
    estimated_fee_native: Number(estimatedFeeNative.toFixed(6)),
    estimated_fee_usd: Number(estimatedFeeUsd.toFixed(2)),
    updated_at: new Date().toISOString(),
  };
}

/**
 * 2. Bitcoin (BTC) Fee Estimation from Mempool.space (with 2.0X Priority Multiplier)
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
      if (data?.fastestFee) {
        satPerVbyte = data.fastestFee;
      } else if (data?.halfHourFee) {
        satPerVbyte = data.halfHourFee;
      }
    }
  } catch {
    // Fallback
  }

  // 2.0X multiplier on sat/vB for guaranteed next-block confirmation
  const prioritySatPerVbyte = Math.ceil(satPerVbyte * 2.0);
  const estimatedSats = prioritySatPerVbyte * 140;
  const estimatedFeeNative = estimatedSats / 1e8;
  const btcPrice = await getAssetUsdPrice('BTC');
  const estimatedFeeUsd = estimatedFeeNative * btcPrice;

  return {
    crypto,
    network,
    base_fee_gwei: null,
    priority_fee_gwei: null,
    sat_per_vbyte: prioritySatPerVbyte,
    estimated_fee_native: Number(estimatedFeeNative.toFixed(8)),
    estimated_fee_usd: Number(estimatedFeeUsd.toFixed(2)),
    updated_at: new Date().toISOString(),
  };
}

/**
 * 3. Tron (TRC20 / TRX) Fee Estimation (with 2.0X Energy/Bandwidth Buffer)
 */
async function estimateTronGasFees(
  crypto: string,
  network: string
): Promise<NetworkGasFee> {
  const isTrc20 = crypto === 'USDT' || crypto === 'USDC' || network === 'TRC20';
  // USDT TRC20 transfer consumes ~32,000 Energy + 345 Bandwidth (~13.5 - 27 TRX)
  // With 2X dynamic buffer to guarantee zero energy failure
  const estimatedFeeNative = isTrc20 ? 25.0 : 2.5;
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
 * 4. Litecoin (LTC) Fee Estimation (with 2.0X Priority Multiplier)
 */
async function estimateLtcGasFees(
  crypto: string,
  network: string
): Promise<NetworkGasFee> {
  const satPerVbyte = 4; // 2x priority rate
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
 * Computes all supported network gas estimates without performing privileged writes.
 * This module is also imported by client UI; never place service-role logic here.
 */
export async function fetchNetworkGasFeeEstimates(): Promise<NetworkGasFee[]> {
  const networksToQuery = [
    { crypto: 'BTC', network: 'BTC' },
    { crypto: 'ETH', network: 'ETH' },
    { crypto: 'USDT', network: 'ERC20' },
    { crypto: 'USDT', network: 'BEP20' },
    { crypto: 'USDT', network: 'TRC20' },
    { crypto: 'USDC', network: 'ERC20' },
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

  if (results.length !== networksToQuery.length) {
    throw new Error(`Gas fee refresh incomplete: estimated ${results.length} of ${networksToQuery.length} supported asset/network pairs.`);
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
    const { getBrowserClient } = await import('@/lib/supabaseClient');
    const browserSupabase = getBrowserClient();
    const { data, error } = await browserSupabase
      .from('network_gas_fees')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    const updatedAt = data?.updated_at ? Date.parse(data.updated_at) : NaN;
    const ageMs = Date.now() - updatedAt;
    if (!error && data && Number.isFinite(updatedAt) && ageMs >= -60_000 && ageMs <= 2 * 60_000) {
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
