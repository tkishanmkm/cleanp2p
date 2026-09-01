'use client';

import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

export default function CreateOrderForm({ onOrderCreated }: { onOrderCreated?: () => void }) {
  const [orderType, setOrderType] = useState<'BUY' | 'SELL'>('SELL');
  const [assetSymbol, setAssetSymbol] = useState('USDT');
  const [fiatCurrency, setFiatCurrency] = useState('INR');
  const [pricePerUnit, setPricePerUnit] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [minLimit, setMinLimit] = useState('');
  const [maxLimit, setMaxLimit] = useState('');
  const [paymentMethods, setPaymentMethods] = useState('UPI, IMPS');

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ success: boolean; text: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      // 1. Explicitly fetch current session token from the browser client
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );

      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError || !session?.access_token) {
        setMessage({ success: false, text: 'You must login. No active browser session found.' });
        setLoading(false);
        return;
      }

      const methodsArray = paymentMethods.split(',').map((m) => m.trim()).filter(Boolean);

      // 2. Submit with explicit Bearer Token Authorization header
      const res = await fetch('/api/p2p/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          orderType,
          assetSymbol,
          fiatCurrency,
          pricePerUnit: Number(pricePerUnit),
          totalAmount: Number(totalAmount),
          minLimit: Number(minLimit),
          maxLimit: Number(maxLimit),
          paymentMethods: methodsArray,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setMessage({ success: true, text: 'Order posted successfully to the marketplace!' });
        setPricePerUnit('');
        setTotalAmount('');
        setMinLimit('');
        setMaxLimit('');
        if (onOrderCreated) onOrderCreated();
      } else {
        setMessage({ success: false, text: data.error || 'Failed to create order' });
      }
    } catch (err: any) {
      setMessage({ success: false, text: err.message || 'An error occurred' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto p-6 bg-slate-900 text-slate-100 rounded-xl shadow-lg border border-slate-800">
      <h3 className="text-xl font-bold mb-4">Post P2P Listing</h3>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm border ${message.success ? 'bg-emerald-950 border-emerald-800 text-emerald-200' : 'bg-red-950 border-red-800 text-red-200'}`}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Order Type</label>
            <select
              value={orderType}
              onChange={(e) => setOrderType(e.target.value as 'BUY' | 'SELL')}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-indigo-500"
            >
              <option value="SELL">SELL (Maker)</option>
              <option value="BUY">BUY (Maker)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Asset Symbol</label>
            <input
              type="text"
              value={assetSymbol}
              onChange={(e) => setAssetSymbol(e.target.value.toUpperCase())}
              required
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-indigo-500 font-mono"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Price per Unit ({fiatCurrency})</label>
            <input
              type="number"
              step="0.01"
              value={pricePerUnit}
              onChange={(e) => setPricePerUnit(e.target.value)}
              placeholder="88.50"
              required
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-indigo-500 font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Total Amount ({assetSymbol})</label>
            <input
              type="number"
              step="0.01"
              value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value)}
              placeholder="100.00"
              required
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-indigo-500 font-mono"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Min Limit ({fiatCurrency})</label>
            <input
              type="number"
              step="1"
              value={minLimit}
              onChange={(e) => setMinLimit(e.target.value)}
              placeholder="500"
              required
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-indigo-500 font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Max Limit ({fiatCurrency})</label>
            <input
              type="number"
              step="1"
              value={maxLimit}
              onChange={(e) => setMaxLimit(e.target.value)}
              placeholder="10000"
              required
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-indigo-500 font-mono"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Payment Methods (comma separated)</label>
          <input
            type="text"
            value={paymentMethods}
            onChange={(e) => setPaymentMethods(e.target.value)}
            placeholder="UPI, IMPS, Bank Transfer"
            required
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-lg transition"
        >
          {loading ? 'Publishing Order...' : 'Post Order Ad'}
        </button>
      </form>
    </div>
  );
}
