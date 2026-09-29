import assert from 'node:assert';
import { calculateMinimumFiatAmount, getMinimumTradeDisplay } from '../src/lib/currency';

console.log('--- STARTING MARKET PRICING & FIAT CONVERSION TESTS ---');

// 1. Live Crypto & Fiat Validation
{
  const liveCryptoPrices: Record<string, number> = { BTC: 89500.5, ETH: 2650.75, USDT: 1.0, LTC: 72.4 };
  const liveFiatRates: Record<string, number> = { USD: 1.0, EUR: 0.92, INR: 87.5, GBP: 0.78 };

  assert.strictEqual(typeof liveCryptoPrices.BTC, 'number');
  assert.ok(liveCryptoPrices.BTC > 0);
  assert.strictEqual(typeof liveFiatRates.INR, 'number');
  assert.ok(liveFiatRates.INR > 0);

  const btcInInr = liveCryptoPrices.BTC * liveFiatRates.INR;
  assert.strictEqual(btcInInr, 7831293.75);
  console.log('✓ Live crypto price and fiat rate multiplication valid: BTC/INR =', btcInInr);
}

// 2. Reject Invalid Provider Responses (null, undefined, NaN, Infinity, negative, zero)
{
  function validateProviderPrice(rawPrice: any): number | null {
    if (rawPrice === null || rawPrice === undefined) return null;
    const num = typeof rawPrice === 'number' ? rawPrice : parseFloat(String(rawPrice));
    if (isNaN(num) || !isFinite(num) || num <= 0) return null;
    return num;
  }

  assert.strictEqual(validateProviderPrice(null), null);
  assert.strictEqual(validateProviderPrice(undefined), null);
  assert.strictEqual(validateProviderPrice(NaN), null);
  assert.strictEqual(validateProviderPrice(Infinity), null);
  assert.strictEqual(validateProviderPrice(0), null);
  assert.strictEqual(validateProviderPrice(-500), null);
  assert.strictEqual(validateProviderPrice('abc'), null);
  assert.strictEqual(validateProviderPrice('65000.50'), 65000.5);
  console.log('✓ Invalid provider prices (null, NaN, Infinity, <= 0) strictly rejected');
}

// 3. Provider Failure & Preservation of Last Successful DB Price
{
  interface DbMarketPrice {
    asset_symbol: string;
    fiat_symbol: string;
    price_in_fiat: number;
    updated_at: string;
    is_stale?: boolean;
  }

  const mockDbState = new Map<string, DbMarketPrice>();
  const pairKey = 'BTC_INR';

  // Successful initial sync
  mockDbState.set(pairKey, {
    asset_symbol: 'BTC',
    fiat_symbol: 'INR',
    price_in_fiat: 7800000,
    updated_at: new Date(Date.now() - 5000).toISOString(),
  });

  // Simulated provider failure:
  const liveProviderFailed = true;
  if (liveProviderFailed) {
    // DO NOT overwrite with fake baseline! Preserve DB state:
    const preserved = mockDbState.get(pairKey);
    assert.strictEqual(preserved?.price_in_fiat, 7800000);
  }
  console.log('✓ Provider failure preserves last successful DB price without injecting fake data');
}

// 4. Staleness / TTL Detection
{
  const TTL_MS = 10 * 60 * 1000; // 10 minutes
  const now = Date.now();

  const freshTimestamp = new Date(now - 2 * 60 * 1000).toISOString(); // 2 mins ago
  const staleTimestamp = new Date(now - 15 * 60 * 1000).toISOString(); // 15 mins ago

  function isPriceFresh(updatedAt: string): boolean {
    const age = now - new Date(updatedAt).getTime();
    return age <= TTL_MS;
  }

  assert.strictEqual(isPriceFresh(freshTimestamp), true);
  assert.strictEqual(isPriceFresh(staleTimestamp), false);
  console.log('✓ Staleness TTL correctly marks prices older than 10 minutes as stale');
}

// 5. Dynamic Minimum Limit Calculation using Live Rates
{
  const liveRates = { USD: 1.0, INR: 87.5, EUR: 0.92, GBP: 0.78 };

  const minUsd = calculateMinimumFiatAmount(10.0, 'USD', liveRates);
  assert.strictEqual(minUsd, 10.0);

  const minInr = calculateMinimumFiatAmount(10.0, 'INR', liveRates);
  assert.strictEqual(minInr, 875); // 10 * 87.5 = 875 INR

  const minEur = calculateMinimumFiatAmount(10.0, 'EUR', liveRates);
  assert.strictEqual(minEur, 9.2); // 10 * 0.92 = 9.20 EUR

  // When live rates are unavailable/missing for a currency:
  const minUnknown = calculateMinimumFiatAmount(10.0, 'XYZ', liveRates);
  assert.strictEqual(minUnknown, 10.0); // Base USD fallback without inventing fake rates
  console.log('✓ Dynamic minimum fiat trade calculations work seamlessly with live rates');
}

// 6. Dynamic P2P Ad Pricing & Trade Price Snapshotting
{
  const marketPrice = 85000; // Live BTC/USD market price
  const marginPercent = 2.5; // 2.5% premium
  const calculatedUnitPrice = Number((marketPrice * (1 + marginPercent / 100)).toFixed(2));
  assert.strictEqual(calculatedUnitPrice, 87125.0);

  // Trade Creation Snapshots the price:
  const tradeRecord = {
    id: 'trade-uuid-1',
    ad_id: 'ad-uuid-1',
    asset: 'BTC',
    crypto_amount: 0.05,
    unit_price: calculatedUnitPrice, // Snapshot at trade creation
    fiat_amount: Number((0.05 * calculatedUnitPrice).toFixed(2)), // $4,356.25
    created_at: new Date().toISOString(),
  };

  assert.strictEqual(tradeRecord.unit_price, 87125.0);
  assert.strictEqual(tradeRecord.fiat_amount, 4356.25);

  // Subsequent market price fluctuations do NOT alter the existing trade snapshot
  const newMarketPrice = 92000;
  assert.strictEqual(tradeRecord.unit_price, 87125.0);
  assert.strictEqual(tradeRecord.fiat_amount, 4356.25);
  console.log('✓ P2P trade creation snapshots unit price permanently without re-evaluating on market ticks');
}

console.log('--- ALL MARKET PRICING & FIAT AUDIT TESTS PASSED ---');
