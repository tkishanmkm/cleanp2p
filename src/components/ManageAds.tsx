"use client";

import React, { useState, useEffect } from 'react';
import { Info, Play, Pause, Trash2, X } from 'lucide-react';
import { FIAT_CURRENCIES } from '@/lib/currencies';

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

function getCurrencySymbol(code: string): string {
  if (!code) return '$';
  const found = FIAT_CURRENCIES.find((c) => c.code.toUpperCase() === code.toUpperCase());
  return found?.symbol || code;
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
        <h2 className="text-xl font-extrabold text-foreground">Manage Your Ads</h2>
        <p className="text-xs text-muted-foreground">View, activate, deactivate, or inspect full details of your marketplace offers.</p>
      </div>

      {ads.length === 0 ? (
        <div className="p-8 text-center rounded-2xl bg-card border border-border text-muted-foreground text-sm">
          No advertisements found. Create your first offer to start trading.
        </div>
      ) : (
        <>
          {/* Desktop Table (Hidden on Mobile) */}
          <div className="hidden md:block overflow-x-auto rounded-2xl bg-card border border-border shadow-xs">
            <table className="w-full text-left text-xs text-foreground">
              <thead className="bg-muted/60 text-muted-foreground uppercase tracking-wider border-b border-border">
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
              <tbody className="divide-y divide-border">
                {ads.map((ad) => {
                  const currSym = getCurrencySymbol(ad.fiat_currency);
                  return (
                    <tr key={ad.id} className="hover:bg-muted/40 transition-colors">
                      <td className="p-4 font-mono font-bold text-primary">{ad.id ? ad.id.substring(0, 8) : 'AD'}...</td>
                      <td className="p-4">
                        <span className={`px-2.5 py-1 rounded-md font-extrabold text-xs ${
                          ad.type === 'BUY' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                        }`}>
                          {ad.type}
                        </span>
                      </td>
                      <td className="p-4 font-semibold text-foreground">{ad.asset}/{ad.fiat_currency}</td>
                      <td className="p-4 font-mono font-bold text-foreground">
                        {currSym}{Number(ad.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {ad.fiat_currency}
                        {ad.pricing_type === 'FLOAT' && (
                          <span className="text-xs text-muted-foreground font-normal ml-1">
                            ({ad.margin_percent && ad.margin_percent > 0 ? `+${ad.margin_percent}` : ad.margin_percent}% float)
                          </span>
                        )}
                      </td>
                      <td className="p-4 space-y-0.5">
                        <div className="text-foreground font-mono">{currSym}{Number(ad.min_limit || 0).toLocaleString()} - {currSym}{Number(ad.max_limit || 0).toLocaleString()} {ad.fiat_currency}</div>
                        <div className="text-[11px] text-muted-foreground">Avail: <span className="text-primary font-semibold">{ad.available_amount} {ad.asset}</span></div>
                      </td>
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                          ad.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25' : 'bg-muted text-muted-foreground border border-border'
                        }`}>
                          {ad.status}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => setSelectedInfoAd(ad)} className="p-2 rounded-lg bg-muted hover:bg-muted/80 text-primary cursor-pointer transition-colors" title="Full Ad Info">
                            <Info className="h-4 w-4" />
                          </button>
                          <button onClick={() => toggleStatus(ad.id, ad.status)} className="p-2 rounded-lg bg-muted hover:bg-muted/80 text-foreground cursor-pointer transition-colors" title={ad.status === 'ACTIVE' ? "Deactivate" : "Activate"}>
                            {ad.status === 'ACTIVE' ? <Pause className="h-4 w-4 text-amber-500" /> : <Play className="h-4 w-4 text-emerald-500" />}
                          </button>
                          <button onClick={() => deleteAd(ad.id)} className="p-2 rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive cursor-pointer transition-colors" title="Delete Ad">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Responsive Cards (Shown strictly on Mobile screens) */}
          <div className="grid grid-cols-1 gap-3 md:hidden">
            {ads.map((ad) => {
              const currSym = getCurrencySymbol(ad.fiat_currency);
              return (
                <div key={ad.id} className="p-4 rounded-2xl bg-card border border-border shadow-xs space-y-3">
                  <div className="flex items-center justify-between border-b border-border pb-2">
                    <div className="flex items-center gap-2">
                      <span className={`px-2.5 py-0.5 rounded-md font-black text-xs ${
                        ad.type === 'BUY' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                      }`}>
                        {ad.type}
                      </span>
                      <span className="font-bold text-foreground text-sm">{ad.asset}/{ad.fiat_currency}</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      ad.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25' : 'bg-muted text-muted-foreground border border-border'
                    }`}>
                      {ad.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground text-[10px]">Price</p>
                      <p className="font-mono font-bold text-foreground">{currSym}{Number(ad.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {ad.fiat_currency}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-[10px]">Available Asset</p>
                      <p className="font-mono font-semibold text-primary">{ad.available_amount} {ad.asset}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-muted-foreground text-[10px]">Trade Limits</p>
                      <p className="font-mono text-foreground">{currSym}{Number(ad.min_limit || 0).toLocaleString()} - {currSym}{Number(ad.max_limit || 0).toLocaleString()} {ad.fiat_currency}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <button 
                      onClick={() => setSelectedInfoAd(ad)} 
                      className="px-3 py-1.5 rounded-xl bg-primary/10 border border-primary/20 text-primary text-xs font-semibold flex items-center gap-1.5 cursor-pointer hover:bg-primary/20 transition-colors"
                    >
                      <Info className="h-3.5 w-3.5" /> Ad Info
                    </button>

                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => toggleStatus(ad.id, ad.status)} 
                        className="px-3 py-1.5 rounded-xl bg-muted hover:bg-muted/80 text-foreground text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        {ad.status === 'ACTIVE' ? <><Pause className="h-3.5 w-3.5 text-amber-500" /> Deactivate</> : <><Play className="h-3.5 w-3.5 text-emerald-500" /> Activate</>}
                      </button>
                      <button 
                        onClick={() => deleteAd(ad.id)} 
                        className="p-1.5 rounded-xl bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/20 cursor-pointer transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Ad Info Modal */}
      {selectedInfoAd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-md rounded-3xl bg-card border border-border p-6 shadow-2xl space-y-4 text-foreground">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-extrabold text-foreground flex items-center gap-2">
                <Info className="h-5 w-5 text-primary" /> Full Ad Information
              </h3>
              <button onClick={() => setSelectedInfoAd(null)} className="p-1 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-muted/50 border border-border space-y-1 font-mono">
                <div className="flex justify-between"><span className="text-muted-foreground">Ad ID:</span><span className="text-foreground">{selectedInfoAd.id}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Type:</span><span className="text-primary font-bold">{selectedInfoAd.type}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Rate:</span><span className="text-foreground font-bold">{getCurrencySymbol(selectedInfoAd.fiat_currency)}{Number(selectedInfoAd.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {selectedInfoAd.fiat_currency}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Available:</span><span className="text-emerald-600 dark:text-emerald-400 font-bold">{selectedInfoAd.available_amount} {selectedInfoAd.asset}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Min - Max Limit:</span><span className="text-foreground">{getCurrencySymbol(selectedInfoAd.fiat_currency)}{Number(selectedInfoAd.min_limit).toLocaleString()} - {getCurrencySymbol(selectedInfoAd.fiat_currency)}{Number(selectedInfoAd.max_limit).toLocaleString()} {selectedInfoAd.fiat_currency}</span></div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-foreground">Accepted Payment Methods</label>
                <div className="flex flex-wrap gap-1.5">
                  {(selectedInfoAd.payment_methods || []).map((pm, idx) => (
                    <span key={idx} className="px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 text-primary font-medium">
                      {pm}
                    </span>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-foreground">Terms & Conditions</label>
                <p className="p-3 rounded-xl bg-muted/40 border border-border text-foreground leading-relaxed max-h-32 overflow-y-auto whitespace-pre-wrap">
                  {selectedInfoAd.terms_conditions || 'No custom terms provided.'}
                </p>
              </div>
            </div>

            <div className="pt-2">
              <button 
                onClick={() => setSelectedInfoAd(null)}
                className="w-full py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs cursor-pointer transition-all"
              >
                Close Window
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { ManageAds };
