'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';

const AVAILABLE_PAYMENTS = ['UPI', 'IMPS', 'Bank Transfer', 'Paytm', 'PhonePe'];

export default function PostAdPage() {
  const router = useRouter();

  const [type, setType] = useState<'BUY' | 'SELL'>('SELL');
  const [coin, setCoin] = useState('USDT');
  const [fiat, setFiat] = useState('INR');
  const [pricingType, setPricingType] = useState<'FIXED' | 'FLOATING'>('FIXED');
  const [priceMargin, setPriceMargin] = useState('100'); // 100% = market rate, 102% = +2%
  const [fixedPriceInput, setFixedPriceInput] = useState('');
  const [marketPrice, setMarketPrice] = useState<number | null>(null);
  const [isLoadingPrice, setIsLoadingPrice] = useState(true);
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [paymentWindow, setPaymentWindow] = useState('15');
  const [selectedPayments, setSelectedPayments] = useState<string[]>(['UPI']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Fetch market spot price whenever asset or fiat changes
  useEffect(() => {
    let isCancelled = false;
    async function fetchSpotPrice() {
      setIsLoadingPrice(true);
      setMarketPrice(null);
      try {
        const res = await fetch(`/api/p2p/market-prices?asset=${coin}&fiat=${fiat}`);
        const data = await res.json();
        if (!isCancelled && data.prices && data.prices.length > 0) {
          const price = data.prices[0].price_in_fiat;
          setMarketPrice(price);
          setFixedPriceInput(price.toString());
        }
      } catch (e) {
        console.error('Failed to load spot price', e);
      } finally {
        if (!isCancelled) {
          setIsLoadingPrice(false);
        }
      }
    }
    fetchSpotPrice();

    return () => {
      isCancelled = true;
    };
  }, [coin, fiat]);

  // Calculate final dynamic unit price
  const calculatedPrice = marketPrice
    ? pricingType === 'FLOATING'
      ? (marketPrice * (parseFloat(priceMargin) || 100)) / 100
      : parseFloat(fixedPriceInput) || marketPrice
    : parseFloat(fixedPriceInput) || 0;

  const togglePaymentMethod = (method: string) => {
    setSelectedPayments((prev) =>
      prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (isLoadingPrice || calculatedPrice <= 0) {
      setError('Please wait for live market pricing to settle before submitting.');
      return;
    }

    const min = parseFloat(minAmount);
    const max = parseFloat(maxAmount);

    if (isNaN(min) || isNaN(max) || min <= 0 || max < min) {
      setError('Please provide valid minimum and maximum order limits.');
      return;
    }

    if (selectedPayments.length === 0) {
      setError('Please select at least one payment method.');
      return;
    }

    setLoading(true);

    try {
      // 1. Get current active session
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError || !session?.user) {
        console.error("Auth session error:", sessionError);
        alert(`Auth Error: No active session found. ${sessionError?.message || ''}`);
        setError(`Auth Error: No active session found. ${sessionError?.message || ''}`);
        setLoading(false);
        return;
      }

      // 2. Perform Insert with explicit user_id and detailed error logging
      const { data, error: insertErr } = await supabase
        .from('p2p_ads')
        .insert([
          {
            user_id: session.user.id, // Explicitly attach authenticated user ID
            type,
            coin,
            fiat,
            price_type: pricingType,
            price_margin: parseFloat(priceMargin) || 100,
            price: calculatedPrice,
            payment_methods: selectedPayments,
            min_amount: min,
            max_amount: max,
            payment_window: parseInt(paymentWindow, 10),
            status: 'ACTIVE',
          }
        ])
        .select();

      if (insertErr) {
        // THIS WILL PRINT THE REAL ERROR IN CONSOLE AND ALERT
        console.error("Database error creating ad:", insertErr);
        alert(`Real Database Error [${insertErr.code}]: ${insertErr.message} - ${insertErr.details || insertErr.hint || ''}`);
        setError(`Real Database Error [${insertErr.code}]: ${insertErr.message} - ${insertErr.details || insertErr.hint || ''}`);
      } else {
        alert("Ad created successfully!");
        router.push('/p2p');
      }
    } catch (err: any) {
      console.error("Database error creating ad:", err);
      alert(`Unexpected error: ${err?.message || String(err)}`);
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="border rounded-xl bg-card p-6 space-y-6 shadow-sm">
        <div>
          <h1 className="text-xl font-bold">Create P2P Advertisement</h1>
          <p className="text-xs text-muted-foreground">
            Post an ad to buy or sell crypto directly with other traders
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Ad Type Toggle */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setType('SELL')}
              className={`py-2.5 rounded-lg text-xs font-bold transition ${
                type === 'SELL'
                  ? 'bg-red-600 text-white'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              I Want to Sell Crypto
            </button>
            <button
              type="button"
              onClick={() => setType('BUY')}
              className={`py-2.5 rounded-lg text-xs font-bold transition ${
                type === 'BUY'
                  ? 'bg-green-600 text-white'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              I Want to Buy Crypto
            </button>
          </div>

          {/* Asset & Currency Selection */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Crypto Asset</label>
              <select
                value={coin}
                onChange={(e) => setCoin(e.target.value)}
                className="w-full p-2.5 border rounded-lg text-xs bg-background"
              >
                <option value="USDT">USDT</option>
                <option value="ETH">ETH</option>
                <option value="BTC">BTC</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Fiat Currency</label>
              <select
                value={fiat}
                onChange={(e) => setFiat(e.target.value)}
                className="w-full p-2.5 border rounded-lg text-xs bg-background"
              >
                <option value="INR">INR (₹)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
                <option value="BRL">BRL (R$)</option>
              </select>
            </div>
          </div>

          {/* Pricing Strategy: Fixed vs Floating */}
          <div className="p-4 border rounded-xl bg-muted/30 space-y-3">
            <div className="flex justify-between items-center">
              <label className="text-xs font-semibold">Pricing Strategy</label>
              <div className="text-xs font-medium">
                {isLoadingPrice ? (
                  <span className="text-muted-foreground animate-pulse">Loading live market rate...</span>
                ) : marketPrice ? (
                  <span className="text-muted-foreground">
                    Market Rate: <span className="font-mono font-semibold text-foreground">1 {coin} ≈ {marketPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {fiat}</span>
                  </span>
                ) : (
                  <span className="text-amber-500">Live rate unavailable</span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setPricingType('FIXED');
                  if (marketPrice && !fixedPriceInput) {
                    setFixedPriceInput(marketPrice.toString());
                  }
                }}
                className={`py-2 rounded-lg text-xs font-medium border transition ${
                  pricingType === 'FIXED'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground'
                }`}
              >
                Fixed Price
              </button>
              <button
                type="button"
                onClick={() => setPricingType('FLOATING')}
                className={`py-2 rounded-lg text-xs font-medium border transition ${
                  pricingType === 'FLOATING'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground'
                }`}
              >
                Floating Margin (%)
              </button>
            </div>

            {pricingType === 'FLOATING' ? (
              <div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Margin Percentage</span>
                  <span>{priceMargin}% ({parseFloat(priceMargin) >= 100 ? `+${(parseFloat(priceMargin) - 100).toFixed(1)}%` : `${(parseFloat(priceMargin) - 100).toFixed(1)}%`})</span>
                </div>
                <input
                  type="number"
                  step="0.1"
                  required
                  placeholder="100"
                  value={priceMargin}
                  onChange={(e) => setPriceMargin(e.target.value)}
                  className="w-full p-2.5 border rounded-lg text-xs bg-background"
                />
              </div>
            ) : (
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Custom Fixed Unit Price ({fiat})</label>
                <input
                  type="number"
                  step="any"
                  required
                  placeholder={marketPrice ? marketPrice.toString() : '0.00'}
                  value={fixedPriceInput}
                  onChange={(e) => setFixedPriceInput(e.target.value)}
                  className="w-full p-2.5 border rounded-lg text-xs bg-background"
                />
              </div>
            )}

            <div className="flex justify-between items-center pt-2 border-t text-xs">
              <span className="text-muted-foreground">Effective Unit Price:</span>
              <span className="font-bold text-sm text-primary">
                {isLoadingPrice ? (
                  <span className="text-muted-foreground font-normal animate-pulse">Calculating...</span>
                ) : (
                  <span>
                    {calculatedPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} {fiat} / {coin}
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* Order Limits */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Min Order Limit ({fiat})</label>
              <input
                type="number"
                required
                placeholder="1000"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
                className="w-full p-2.5 border rounded-lg text-xs bg-background"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Max Order Limit ({fiat})</label>
              <input
                type="number"
                required
                placeholder="50000"
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
                className="w-full p-2.5 border rounded-lg text-xs bg-background"
              />
            </div>
          </div>

          {/* Payment Window */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Payment Time Window</label>
            <select
              value={paymentWindow}
              onChange={(e) => setPaymentWindow(e.target.value)}
              className="w-full p-2.5 border rounded-lg text-xs bg-background"
            >
              <option value="15">15 Minutes</option>
              <option value="30">30 Minutes</option>
              <option value="45">45 Minutes</option>
            </select>
          </div>

          {/* Supported Payment Methods */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-2">Supported Payment Methods</label>
            <div className="flex flex-wrap gap-2">
              {AVAILABLE_PAYMENTS.map((method) => {
                const isSelected = selectedPayments.includes(method);
                return (
                  <button
                    key={method}
                    type="button"
                    onClick={() => togglePaymentMethod(method)}
                    className={`px-3 py-1.5 rounded-lg text-xs border transition ${
                      isSelected
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {isSelected ? `✓ ${method}` : `+ ${method}`}
                  </button>
                );
              })}
            </div>
          </div>

          {error && <p className="text-xs text-red-500 font-medium">{error}</p>}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => router.push('/p2p')}
              className="w-1/2 py-2.5 border rounded-lg text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || isLoadingPrice || calculatedPrice <= 0}
              className="w-1/2 py-2.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold disabled:opacity-50"
            >
              {loading ? 'Publishing Ad...' : isLoadingPrice ? 'Loading price...' : 'Publish Advertisement'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
