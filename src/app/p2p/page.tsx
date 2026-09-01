'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';

export default function P2PMarketplace() {
  const router = useRouter();
  const [supabase] = useState(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';
    return createBrowserClient(url, key);
  });

  const [activeTab, setActiveTab] = useState<'BUY' | 'SELL'>('BUY'); // BUY crypto = view SELL ads
  const [ads, setAds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAd, setSelectedAd] = useState<any | null>(null);
  const [tradeAmount, setTradeAmount] = useState('');
  const [tradeError, setTradeError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Live market rates
  const [marketPrices, setMarketPrices] = useState<Record<string, number>>({});
  const [isLoadingPrices, setIsLoadingPrices] = useState(true);

  // Fetch live market prices
  useEffect(() => {
    async function fetchSpotPrices() {
      setIsLoadingPrices(true);
      try {
        const res = await fetch('/api/p2p/market-prices?fiat=USD');
        const data = await res.json();
        if (data.prices && Array.isArray(data.prices)) {
          const map: Record<string, number> = {};
          data.prices.forEach((p: any) => {
            map[p.asset_symbol] = p.price_in_fiat;
          });
          setMarketPrices(map);
        }
      } catch (e) {
        console.error('Failed to load spot prices', e);
      } finally {
        setIsLoadingPrices(false);
      }
    }
    fetchSpotPrices();
  }, []);

  // Fetch active ads
  useEffect(() => {
    async function loadAds() {
      setLoading(true);
      // If user wants to "BUY" crypto, show "SELL" ads (and vice versa)
      const targetAdType = activeTab === 'BUY' ? 'SELL' : 'BUY';

      const { data } = await supabase
        .from('p2p_ads')
        .select('*, profiles:user_id(email)')
        .eq('type', targetAdType)
        .eq('status', 'ACTIVE')
        .order('created_at', { ascending: false });

      if (data) setAds(data);
      setLoading(false);
    }

    loadAds();
  }, [activeTab, supabase]);

  // Execute Trade Creation
  const handleInitiateTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAd || !tradeAmount) return;

    setIsSubmitting(true);
    setTradeError('');

    try {
      const res = await fetch('/api/p2p/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adId: selectedAd.id,
          amountFiat: parseFloat(tradeAmount),
        }),
      });

      const data = await res.json();
      if (data.success && data.orderId) {
        router.push(`/p2p/trade/${data.orderId}`);
      } else {
        setTradeError(data.error || 'Failed to initiate order.');
      }
    } catch (err: any) {
      setTradeError(err.message || 'Server error.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold">P2P Crypto Marketplace</h1>
          <p className="text-sm text-muted-foreground">Buy and sell crypto directly with zero fee escrow</p>
        </div>
        <button
          onClick={() => router.push('/p2p/post-ad')}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium"
        >
          + Post New Ad
        </button>
      </div>

      {/* Live Market Price Tracker */}
      <div className="p-3 border rounded-xl bg-card flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-ping" />
          <span className="font-semibold">Live Market Rates (USD):</span>
        </div>
        {isLoadingPrices ? (
          <div className="text-muted-foreground animate-pulse">
            Loading live market price feeds...
          </div>
        ) : Object.keys(marketPrices).length > 0 ? (
          <div className="flex flex-wrap items-center gap-4">
            {['BTC', 'ETH', 'USDT'].map((sym) => {
              const p = marketPrices[sym];
              return (
                <div key={sym} className="flex items-center gap-1.5 bg-muted/60 px-2.5 py-1 rounded-md">
                  <span className="font-medium">{sym}:</span>
                  <span className="font-mono font-bold text-foreground">
                    {p !== undefined ? `$${p.toLocaleString(undefined, { minimumFractionDigits: sym === 'USDT' ? 2 : 2, maximumFractionDigits: sym === 'USDT' ? 4 : 2 })}` : 'N/A'}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <span className="text-amber-500">Market price feed standby</span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-4">
        <button
          onClick={() => setActiveTab('BUY')}
          className={`px-6 py-2 rounded-lg font-semibold text-sm ${
            activeTab === 'BUY' ? 'bg-green-600 text-white' : 'bg-muted text-muted-foreground'
          }`}
        >
          Buy Crypto
        </button>
        <button
          onClick={() => setActiveTab('SELL')}
          className={`px-6 py-2 rounded-lg font-semibold text-sm ${
            activeTab === 'SELL' ? 'bg-red-600 text-white' : 'bg-muted text-muted-foreground'
          }`}
        >
          Sell Crypto
        </button>
      </div>

      {/* Ads Table */}
      {loading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">Loading marketplace offers...</div>
      ) : ads.length === 0 ? (
        <div className="p-12 text-center border rounded-xl bg-card text-muted-foreground">
          No active {activeTab === 'BUY' ? 'Sell' : 'Buy'} offers available right now.
        </div>
      ) : (
        <div className="border rounded-xl bg-card overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-xs uppercase text-muted-foreground border-b">
              <tr>
                <th className="p-4">Advertiser</th>
                <th className="p-4">Limit / Fiat</th>
                <th className="p-4">Payment Methods</th>
                <th className="p-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {ads.map((ad) => (
                <tr key={ad.id} className="hover:bg-muted/50 transition">
                  <td className="p-4 font-medium">{ad.profiles?.email?.split('@')[0] || 'Merchant'}</td>
                  <td className="p-4">
                    <p className="font-semibold">{ad.min_amount} - {ad.max_amount} {ad.fiat}</p>
                    <p className="text-xs text-muted-foreground">{ad.coin}</p>
                  </td>
                  <td className="p-4">
                    <div className="flex gap-1 flex-wrap">
                      {(ad.payment_methods || []).map((method: string) => (
                        <span key={method} className="px-2 py-0.5 bg-muted rounded text-xs border">
                          {method}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="p-4 text-right">
                    <button
                      onClick={() => setSelectedAd(ad)}
                      className={`px-4 py-2 rounded text-xs font-bold text-white ${
                        activeTab === 'BUY' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                      }`}
                    >
                      {activeTab === 'BUY' ? 'Buy USDT' : 'Sell USDT'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Order Execution Modal */}
      {selectedAd && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-card border rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="font-bold">
                {activeTab === 'BUY' ? 'Buy' : 'Sell'} {selectedAd.coin}
              </h3>
              <button onClick={() => setSelectedAd(null)} className="text-muted-foreground hover:text-foreground">
                ✕
              </button>
            </div>

            <div className="p-3 bg-muted/40 rounded-lg text-xs space-y-1.5 border">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Live Market Rate:</span>
                <span className="font-semibold">
                  {isLoadingPrices ? (
                    <span className="text-muted-foreground animate-pulse">Loading live market price...</span>
                  ) : marketPrices[selectedAd.coin] ? (
                    <span>1 {selectedAd.coin} ≈ ${marketPrices[selectedAd.coin].toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  ) : (
                    <span className="text-amber-500">Price unavailable</span>
                  )}
                </span>
              </div>
              {selectedAd.price && (
                <div className="flex justify-between items-center text-muted-foreground">
                  <span>Merchant Rate:</span>
                  <span className="font-mono font-medium text-foreground">
                    {selectedAd.price} {selectedAd.fiat} / {selectedAd.coin}
                  </span>
                </div>
              )}
            </div>

            <form onSubmit={handleInitiateTrade} className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Enter Amount ({selectedAd.fiat})</label>
                <input
                  type="number"
                  required
                  min={selectedAd.min_amount}
                  max={selectedAd.max_amount}
                  placeholder={`${selectedAd.min_amount} - ${selectedAd.max_amount}`}
                  value={tradeAmount}
                  onChange={(e) => setTradeAmount(e.target.value)}
                  className="w-full p-2.5 border rounded-lg text-sm bg-background"
                />
              </div>

              {tradeAmount && (
                <div className="p-3 bg-muted rounded-lg text-xs space-y-1">
                  <div className="flex justify-between">
                    <span>Estimated Crypto:</span>
                    <span className="font-bold">{(parseFloat(tradeAmount) || 0).toFixed(2)} {selectedAd.coin}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Payment Window:</span>
                    <span>{selectedAd.payment_window || 15} min</span>
                  </div>
                </div>
              )}

              {tradeError && <p className="text-xs text-red-500">{tradeError}</p>}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedAd(null)}
                  className="w-1/2 py-2 border rounded-lg text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-1/2 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {isSubmitting ? 'Opening Trade...' : 'Confirm Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
