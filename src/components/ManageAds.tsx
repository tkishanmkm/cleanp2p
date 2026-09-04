"use client";

import React, { useState, useEffect } from 'react';
import { Info, Play, Pause, Trash2, ShieldAlert, CheckCircle2, X } from 'lucide-react';

export interface AdItem {
  id: string;
  type: 'BUY' | 'SELL';
  asset: string;
  fiat_currency: string;
  price: number;
  pricing_type: 'FIXED' | 'FLOAT';
  margin_percent?: number;
  status: 'ACTIVE' | 'INACTIVE';
  min_limit: number;
  max_limit: number;
  available_amount: number;
  payment_methods: string[];
  terms_conditions?: string;
  created_at: string;
}

export default function ManageAds({ ads: initialAds = [] }: { ads?: AdItem[] }) {
  const [ads, setAds] = useState<AdItem[]>(initialAds || []);
  const [selectedInfoAd, setSelectedInfoAd] = useState<AdItem | null>(null);

  useEffect(() => {
    if (initialAds) {
      setAds(initialAds);
    }
  }, [initialAds]);

  const toggleStatus = async (id: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    setAds(prev => prev.map(a => a.id === id ? { ...a, status: nextStatus as any } : a));
    
    try {
      await fetch(`/api/ads/${id}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
    } catch (err) {
      console.error('Failed to toggle ad status:', err);
    }
  };

  const deleteAd = async (id: string) => {
    if (!confirm('Are you sure you want to delete this ad?')) return;
    setAds(prev => prev.filter(a => a.id !== id));
    try {
      await fetch(`/api/ads/${id}`, { method: 'DELETE' });
    } catch (err) {
      console.error('Failed to delete ad:', err);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-extrabold text-white">Manage Your Ads</h2>
        <p className="text-xs text-slate-400">View, activate, deactivate, or inspect full details of your marketplace offers.</p>
      </div>

      {ads.length === 0 ? (
        <div className="p-8 text-center rounded-2xl bg-slate-900 border border-slate-800 text-slate-400 text-sm">
          No advertisements found. Create your first offer to start trading.
        </div>
      ) : (
        <>
          {/* Desktop Table (Hidden on Mobile) */}
          <div className="hidden md:block overflow-x-auto rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th className="p-4">Ad ID</th>
                  <th className="p-4">Type</th>
                  <th className="p-4">Asset</th>
                  <th className="p-4">Price</th>
                  <th className="p-4">Limits & Available</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {ads.map((ad) => (
                  <tr key={ad.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="p-4 font-mono font-bold text-indigo-400">{ad.id ? ad.id.substring(0, 8) : 'AD'}...</td>
                    <td className="p-4">
                      <span className={`px-2.5 py-1 rounded-md font-extrabold ${
                        ad.type === 'BUY' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                      }`}>
                        {ad.type}
                      </span>
                    </td>
                    <td className="p-4 font-semibold text-white">{ad.asset}/{ad.fiat_currency}</td>
                    <td className="p-4 font-mono font-bold text-white">
                      ${Number(ad.price || 0).toLocaleString()} {ad.pricing_type === 'FLOAT' && `(${ad.margin_percent}% float)`}
                    </td>
                    <td className="p-4 space-y-0.5">
                      <div className="text-white font-mono">{Number(ad.min_limit || 0).toLocaleString()} - {Number(ad.max_limit || 0).toLocaleString()} {ad.fiat_currency}</div>
                      <div className="text-[11px] text-slate-400">Avail: <span className="text-indigo-300 font-semibold">{ad.available_amount} {ad.asset}</span></div>
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                        ad.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'
                      }`}>
                        {ad.status}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => setSelectedInfoAd(ad)} className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-400 cursor-pointer" title="Full Ad Info">
                          <Info className="h-4 w-4" />
                        </button>
                        <button onClick={() => toggleStatus(ad.id, ad.status)} className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer" title={ad.status === 'ACTIVE' ? "Deactivate" : "Activate"}>
                          {ad.status === 'ACTIVE' ? <Pause className="h-4 w-4 text-amber-400" /> : <Play className="h-4 w-4 text-emerald-400" />}
                        </button>
                        <button onClick={() => deleteAd(ad.id)} className="p-2 rounded-lg bg-slate-800 hover:bg-rose-950 text-rose-400 cursor-pointer" title="Delete Ad">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Responsive Cards (Shown strictly on Mobile screens) */}
          <div className="grid grid-cols-1 gap-3 md:hidden">
            {ads.map((ad) => (
              <div key={ad.id} className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-lg space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-0.5 rounded-md font-black text-xs ${
                      ad.type === 'BUY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                    }`}>
                      {ad.type}
                    </span>
                    <span className="font-bold text-white text-sm">{ad.asset}/{ad.fiat_currency}</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    ad.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {ad.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-slate-400 text-[10px]">Price</p>
                    <p className="font-mono font-bold text-white">${Number(ad.price || 0).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-[10px]">Available Asset</p>
                    <p className="font-mono font-semibold text-indigo-300">{ad.available_amount} {ad.asset}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-slate-400 text-[10px]">Trade Limits</p>
                    <p className="font-mono text-slate-200">{Number(ad.min_limit || 0).toLocaleString()} - {Number(ad.max_limit || 0).toLocaleString()} {ad.fiat_currency}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                  <button 
                    onClick={() => setSelectedInfoAd(ad)} 
                    className="px-3 py-1.5 rounded-xl bg-indigo-600/10 border border-indigo-500/30 text-indigo-400 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Info className="h-3.5 w-3.5" /> Ad Info
                  </button>

                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => toggleStatus(ad.id, ad.status)} 
                      className="px-3 py-1.5 rounded-xl bg-slate-800 text-slate-200 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      {ad.status === 'ACTIVE' ? <><Pause className="h-3.5 w-3.5 text-amber-400" /> Deactivate</> : <><Play className="h-3.5 w-3.5 text-emerald-400" /> Activate</>}
                    </button>
                    <button 
                      onClick={() => deleteAd(ad.id)} 
                      className="p-1.5 rounded-xl bg-rose-950/40 text-rose-400 border border-rose-800/40 cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Ad Info Modal */}
      {selectedInfoAd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                <Info className="h-5 w-5 text-indigo-400" /> Full Ad Information
              </h3>
              <button onClick={() => setSelectedInfoAd(null)} className="p-1 rounded-lg text-slate-400 hover:text-white cursor-pointer">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1 font-mono">
                <div className="flex justify-between"><span className="text-slate-400">Ad ID:</span><span className="text-white">{selectedInfoAd.id}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Type:</span><span className="text-indigo-400 font-bold">{selectedInfoAd.type}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Rate:</span><span className="text-white">${selectedInfoAd.price}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Available:</span><span className="text-emerald-400">{selectedInfoAd.available_amount} {selectedInfoAd.asset}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Min - Max Limit:</span><span className="text-white">{selectedInfoAd.min_limit} - {selectedInfoAd.max_limit} {selectedInfoAd.fiat_currency}</span></div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Accepted Payment Methods</label>
                <div className="flex flex-wrap gap-1.5">
                  {(selectedInfoAd.payment_methods || []).map((pm, idx) => (
                    <span key={idx} className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 font-medium">
                      {pm}
                    </span>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Terms & Conditions</label>
                <p className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 leading-relaxed max-h-32 overflow-y-auto">
                  {selectedInfoAd.terms_conditions || 'No custom terms provided.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { ManageAds };
