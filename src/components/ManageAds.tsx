"use client";

import React, { useState, useEffect } from 'react';
import { Info, Play, Pause, Trash2, X, Share2, Copy, Check, ExternalLink, Send } from 'lucide-react';
import { FIAT_CURRENCIES } from '@/lib/currencies';
import Link from 'next/link';

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
  if (!code) return '';
  const upper = code.toUpperCase();
  if (upper === 'INR') return '₹';
  if (upper === 'USD') return '$';
  if (upper === 'EUR') return '€';
  if (upper === 'GBP') return '£';
  if (upper === 'JPY' || upper === 'CNY') return '¥';
  const found = FIAT_CURRENCIES.find((c) => c.code.toUpperCase() === upper);
  return found?.symbol || code;
}

export default function ManageAds({ ads: initialAds = [] }: { ads?: AdItem[] }) {
  const [ads, setAds] = useState<AdItem[]>(initialAds || []);
  const [selectedInfoAd, setSelectedInfoAd] = useState<AdItem | null>(null);
  const [shareModalAd, setShareModalAd] = useState<AdItem | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (initialAds) {
      setAds(initialAds);
    }
  }, [initialAds]);

  const handleShare = async (ad: AdItem) => {
    const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/ad/${ad.id}` : `/ad/${ad.id}`;
    const shareText = `${ad.type === 'BUY' ? 'Buying' : 'Selling'} ${ad.asset} on PaxOnes P2P at ${getCurrencySymbol(ad.fiat_currency)}${ad.price} ${ad.fiat_currency}`;

    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: `Trade ${ad.asset} on PaxOnes`,
          text: shareText,
          url: shareUrl,
        });
        return;
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.warn('Native share failed, opening modal fallback:', err);
        } else {
          return;
        }
      }
    }

    setShareModalAd(ad);
    setCopied(false);
  };

  const copyShareLink = (adId: string) => {
    const shareUrl = `${window.location.origin}/ad/${adId}`;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

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
        <p className="text-xs text-muted-foreground">View, share, activate, deactivate, or inspect full details of your marketplace offers.</p>
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
                          <button 
                            onClick={() => handleShare(ad)} 
                            className="p-2 rounded-lg bg-[#9273FC]/10 hover:bg-[#9273FC]/20 text-[#9273FC] cursor-pointer transition-colors" 
                            title="Share Ad Link"
                          >
                            <Share2 className="h-4 w-4" />
                          </button>
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

                  <div className="flex items-center justify-between pt-2 border-t border-border gap-2">
                    <div className="flex items-center gap-1.5">
                      <button 
                        onClick={() => handleShare(ad)} 
                        className="px-2.5 py-1.5 rounded-xl bg-[#6347ea]/10 border border-[#6347ea]/20 text-[#6347ea] text-xs font-semibold flex items-center gap-1 cursor-pointer hover:bg-[#6347ea]/20 transition-colors"
                        title="Share Ad"
                      >
                        <Share2 className="h-3.5 w-3.5" /> Share
                      </button>
                      <button 
                        onClick={() => setSelectedInfoAd(ad)} 
                        className="px-2.5 py-1.5 rounded-xl bg-primary/10 border border-primary/20 text-primary text-xs font-semibold flex items-center gap-1 cursor-pointer hover:bg-primary/20 transition-colors"
                      >
                        <Info className="h-3.5 w-3.5" /> Info
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button 
                        onClick={() => toggleStatus(ad.id, ad.status)} 
                        className="px-2.5 py-1.5 rounded-xl bg-muted hover:bg-muted/80 text-foreground text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        {ad.status === 'ACTIVE' ? <><Pause className="h-3.5 w-3.5 text-amber-500" /> Pause</> : <><Play className="h-3.5 w-3.5 text-emerald-500" /> Start</>}
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

      {/* Share Ad Modal */}
      {shareModalAd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-md rounded-3xl bg-card border border-border p-6 shadow-2xl space-y-4 text-foreground">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-extrabold text-foreground flex items-center gap-2">
                <Share2 className="h-5 w-5 text-[#6347ea]" /> Share Advertisement
              </h3>
              <button onClick={() => setShareModalAd(null)} className="p-1 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-3 rounded-2xl bg-[#6347ea]/10 border border-[#6347ea]/20 text-xs text-foreground space-y-1">
              <div className="font-bold text-sm text-[#6347ea]">
                {shareModalAd.type === 'BUY' ? 'Buy' : 'Sell'} {shareModalAd.asset} Offer
              </div>
              <div className="text-muted-foreground">
                Rate: {getCurrencySymbol(shareModalAd.fiat_currency)}{Number(shareModalAd.price).toLocaleString()} {shareModalAd.fiat_currency} | Limits: {getCurrencySymbol(shareModalAd.fiat_currency)}{Number(shareModalAd.min_limit).toLocaleString()} - {getCurrencySymbol(shareModalAd.fiat_currency)}{Number(shareModalAd.max_limit).toLocaleString()}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-foreground">Public Ad Link</label>
              <div className="flex items-center gap-2">
                <input 
                  type="text" 
                  readOnly 
                  value={typeof window !== 'undefined' ? `${window.location.origin}/ad/${shareModalAd.id}` : `/ad/${shareModalAd.id}`}
                  className="flex-1 px-3 py-2 text-xs rounded-xl bg-muted/60 border border-border font-mono text-foreground focus:outline-hidden select-all"
                />
                <button
                  onClick={() => copyShareLink(shareModalAd.id)}
                  className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                    copied 
                      ? 'bg-emerald-600 text-white' 
                      : 'bg-[#6347ea] hover:bg-[#5238d6] text-white'
                  }`}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            <div className="space-y-2 pt-1">
              <label className="text-xs font-bold text-muted-foreground">Quick Share via</label>
              <div className="grid grid-cols-3 gap-2">
                <a
                  href={`https://api.whatsapp.com/send?text=${encodeURIComponent(`Check out my ${shareModalAd.type} ${shareModalAd.asset} offer on PaxOnes P2P: ${typeof window !== 'undefined' ? `${window.location.origin}/ad/${shareModalAd.id}` : ''}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="py-2.5 px-3 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Send className="h-3.5 w-3.5" /> WhatsApp
                </a>
                <a
                  href={`https://t.me/share/url?url=${encodeURIComponent(typeof window !== 'undefined' ? `${window.location.origin}/ad/${shareModalAd.id}` : '')}&text=${encodeURIComponent(`Trade ${shareModalAd.asset} with me on PaxOnes P2P`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="py-2.5 px-3 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 text-sky-600 dark:text-sky-400 border border-sky-500/20 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Send className="h-3.5 w-3.5" /> Telegram
                </a>
                <a
                  href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Trade ${shareModalAd.asset} on PaxOnes P2P: ${typeof window !== 'undefined' ? `${window.location.origin}/ad/${shareModalAd.id}` : ''}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="py-2.5 px-3 rounded-xl bg-slate-500/10 hover:bg-slate-500/20 text-foreground border border-border text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> X / Twitter
                </a>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-border">
              <Link 
                href={`/ad/${shareModalAd.id}`}
                target="_blank"
                className="flex-1 py-2.5 rounded-xl bg-muted hover:bg-muted/80 text-foreground font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" /> View Public Page
              </Link>
              <button 
                onClick={() => setShareModalAd(null)}
                className="px-5 py-2.5 rounded-xl bg-[#6347ea] hover:bg-[#5238d6] text-white font-bold text-xs cursor-pointer transition-all"
              >
                Done
              </button>
            </div>
          </div>
        </div>
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

            <div className="flex items-center gap-2 pt-2">
              <button 
                onClick={() => {
                  const ad = selectedInfoAd;
                  setSelectedInfoAd(null);
                  handleShare(ad);
                }}
                className="flex-1 py-2.5 rounded-xl bg-[#6347ea]/10 hover:bg-[#6347ea]/20 text-[#6347ea] border border-[#6347ea]/30 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all"
              >
                <Share2 className="h-3.5 w-3.5" /> Share Offer
              </button>
              <button 
                onClick={() => setSelectedInfoAd(null)}
                className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs cursor-pointer transition-all"
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
