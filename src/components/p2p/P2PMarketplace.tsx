'use client';

import { useState, useEffect } from 'react';

interface P2POrder {
  id: string;
  order_type: 'BUY' | 'SELL';
  asset_symbol: string;
  fiat_currency: string;
  price_per_unit: number;
  available_amount: number;
  min_limit: number;
  max_limit: number;
  payment_methods: string[];
}

export default function P2PMarketplace() {
  const [orders, setOrders] = useState<P2POrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal State for Trade Initiation
  const [selectedOrder, setSelectedOrder] = useState<P2POrder | null>(null);
  const [tradeAmount, setTradeAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [tradeResult, setTradeResult] = useState<any | null>(null);

  // Fetch active orders on load
  useEffect(() => {
    fetchOrders();
  }, []);

  async function fetchOrders() {
    try {
      setLoading(true);
      const res = await fetch('/api/p2p/orders?asset=USDT', {
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success) {
        setOrders(data.orders || []);
      } else {
        setError(data.error);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch order book');
    } finally {
      setLoading(false);
    }
  }

  async function handleInitiateTrade(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedOrder) return;

    try {
      setSubmitting(true);
      setError(null);

      const res = await fetch('/api/p2p/trade/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          orderId: selectedOrder.id,
          amount: Number(tradeAmount),
        }),
      });

      const data = await res.json();
      if (data.success) {
        setTradeResult(data);
        fetchOrders(); // Refresh order book quantities
      } else {
        setError(data.error);
      }
    } catch (err: any) {
      setError(err.message || 'Trade initiation failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 bg-slate-900 text-slate-100 rounded-xl shadow-lg border border-slate-800">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">P2P Marketplace (USDT)</h2>
        <button
          onClick={fetchOrders}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-sm font-medium rounded-lg border border-slate-700 transition"
        >
          Refresh Orders
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-950 border border-red-800 text-red-200 rounded-lg text-sm">
          {error}
        </div>
      )}

      {tradeResult && (
        <div className="mb-6 p-4 bg-emerald-950 border border-emerald-800 text-emerald-200 rounded-lg">
          <p className="font-semibold">Trade Initiated Successfully!</p>
          <p className="text-sm">Trade ID: {tradeResult.tradeId}</p>
          <p className="text-sm">Total Fiat Amount: {tradeResult.fiatAmount}</p>
          <button
            onClick={() => { setTradeResult(null); setSelectedOrder(null); }}
            className="mt-3 px-3 py-1 bg-emerald-800 hover:bg-emerald-700 text-xs rounded font-medium"
          >
            Close
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-10 text-slate-400">Loading order book...</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-10 text-slate-400">No active P2P orders available.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 text-xs uppercase tracking-wider">
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Price / Unit</th>
                <th className="py-3 px-4">Available</th>
                <th className="py-3 px-4">Limits</th>
                <th className="py-3 px-4">Methods</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-sm">
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-slate-800/50">
                  <td className="py-4 px-4 font-semibold">
                    <span className={order.order_type === 'SELL' ? 'text-emerald-400' : 'text-blue-400'}>
                      {order.order_type}
                    </span>
                  </td>
                  <td className="py-4 px-4 font-mono font-medium">
                    {order.price_per_unit} {order.fiat_currency}
                  </td>
                  <td className="py-4 px-4 font-mono">
                    {order.available_amount} {order.asset_symbol}
                  </td>
                  <td className="py-4 px-4 text-slate-400 text-xs">
                    {order.min_limit} - {order.max_limit} {order.fiat_currency}
                  </td>
                  <td className="py-4 px-4">
                    <div className="flex gap-1 flex-wrap">
                      {order.payment_methods?.map((method, idx) => (
                        <span key={idx} className="px-2 py-0.5 bg-slate-800 text-xs rounded text-slate-300">
                          {method}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-4 px-4 text-right">
                    <button
                      onClick={() => setSelectedOrder(order)}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition"
                    >
                      Buy USDT
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Trade Modal */}
      {selectedOrder && !tradeResult && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-xl font-bold mb-4">
              Initiate Trade ({selectedOrder.order_type} {selectedOrder.asset_symbol})
            </h3>
            <p className="text-sm text-slate-400 mb-4">
              Price: <span className="text-slate-100 font-mono">{selectedOrder.price_per_unit} {selectedOrder.fiat_currency}</span>
              <br />
              Available: <span className="text-slate-100 font-mono">{selectedOrder.available_amount} {selectedOrder.asset_symbol}</span>
            </p>

            <form onSubmit={handleInitiateTrade} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Amount to Buy</label>
                <input
                  type="number"
                  step="0.01"
                  max={selectedOrder.available_amount}
                  value={tradeAmount}
                  onChange={(e) => setTradeAmount(e.target.value)}
                  placeholder="0.00"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {tradeAmount && (
                <div className="p-3 bg-slate-950 rounded-lg text-sm">
                  <span className="text-slate-400">Total Fiat Cost: </span>
                  <span className="font-bold text-indigo-400 font-mono">
                    {(Number(tradeAmount) * selectedOrder.price_per_unit).toFixed(2)} {selectedOrder.fiat_currency}
                  </span>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedOrder(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-sm rounded-lg font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition"
                >
                  {submitting ? 'Locking Escrow...' : 'Confirm Trade'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
