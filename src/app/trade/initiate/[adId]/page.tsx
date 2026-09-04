"use client";

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeftRight, ShieldCheck, Tag, FileText, AlertCircle, Loader2 } from 'lucide-react';

export default function TradeInitiationPage() {
  const params = useParams();
  const rawAdId = Array.isArray(params?.adId) ? params.adId[0] : params?.adId;
  const adId = rawAdId || '';
  const router = useRouter();

  const [ad, setAd] = useState<any>(null);
  const [fiatAmount, setFiatAmount] = useState<string>('');
  const [cryptoAmount, setCryptoAmount] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'FIAT' | 'CRYPTO'>('FIAT');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAd() {
      if (!adId) return;
      try {
        const res = await fetch(`/api/ads/${adId}`);
        const data = await res.json();
        const adData = data.ad || (data.id ? data : null);
        if (adData) {
          setAd(adData);
          // Default to min limit
          const minLim = adData.min_limit ?? 100;
          const price = adData.price || 1;
          setFiatAmount(minLim.toString());
          setCryptoAmount((minLim / price).toFixed(6));
        }
      } catch (err) {
        console.error('Failed to fetch ad:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchAd();
  }, [adId]);

  const handleFiatChange = (val: string) => {
    setFiatAmount(val);
    const num = parseFloat(val);
    if (!isNaN(num) && ad && ad.price > 0) {
      setCryptoAmount((num / ad.price).toFixed(6));
    } else {
      setCryptoAmount('');
    }
  };

  const handleCryptoChange = (val: string) => {
    setCryptoAmount(val);
    const num = parseFloat(val);
    if (!isNaN(num) && ad && ad.price > 0) {
      setFiatAmount((num * ad.price).toFixed(2));
    } else {
      setFiatAmount('');
    }
  };

  const handleInitiateTrade = async () => {
    setErrorMsg(null);
    const fiatNum = parseFloat(fiatAmount);
    
    if (isNaN(fiatNum) || fiatNum < ad.min_limit || fiatNum > ad.max_limit) {
      setErrorMsg(`Amount must be between ${ad.min_limit} and ${ad.max_limit} ${ad.fiat_currency}`);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/trades/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ad_id: ad.id,
          fiat_amount: fiatNum,
          crypto_amount: parseFloat(cryptoAmount) || (ad.price > 0 ? fiatNum / ad.price : 0),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to initiate trade.');

      // Redirect to active trade chat room
      const targetTradeId = data.trade_id || data.id;
      router.push(`/trade/${targetTradeId}`);
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred while initiating the trade.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="min-h-[60vh] flex items-center justify-center text-slate-400"><Loader2 className="h-8 w-8 animate-spin text-indigo-500" /></div>;
  if (!ad) return <div className="p-8 text-center text-rose-400">Ad not found or inactive.</div>;

  const isBuy = (ad.type || '').toUpperCase() === 'SELL'; // Ad is SELL -> Viewer is Buying

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`px-3 py-1 rounded-xl text-xs font-black ${
              isBuy ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
            }`}>
              {isBuy ? 'BUY' : 'SELL'} {ad.asset}
            </span>
            <span className="text-sm font-semibold text-slate-300">with {ad.fiat_currency}</span>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-slate-400">Unit Price</p>
            <p className="text-base font-mono font-extrabold text-white">${Number(ad.price || 0).toLocaleString()}</p>
          </div>
        </div>

        {/* Dynamic Presence Indicator */}
        <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80 text-xs text-slate-400">
          <span className={`h-2.5 w-2.5 rounded-full ${ad.trader_presence === 'Online' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
          <span>Trader status: <strong className="text-slate-200">{ad.trader_presence || 'Offline'}</strong></span>
        </div>
      </div>

      {/* Amount Calculator Card */}
      <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl space-y-5">
        <h2 className="text-sm font-bold text-white flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4 text-indigo-400" /> Enter Trade Amount
        </h2>

        {/* Tab Selection */}
        <div className="flex rounded-xl bg-slate-950 p-1 border border-slate-800">
          <button
            onClick={() => setActiveTab('FIAT')}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'FIAT' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Pay in {ad.fiat_currency}
          </button>
          <button
            onClick={() => setActiveTab('CRYPTO')}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'CRYPTO' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Receive in {ad.asset}
          </button>
        </div>

        {/* Inputs */}
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-300">
              {isBuy ? 'I want to pay' : 'I want to sell'}
            </label>
            <div className="mt-1 relative">
              <input
                type="number"
                value={fiatAmount}
                onChange={(e) => handleFiatChange(e.target.value)}
                placeholder={`${ad.min_limit} - ${ad.max_limit}`}
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-sm focus:outline-none focus:border-indigo-500"
              />
              <span className="absolute right-4 top-3.5 text-xs font-bold text-slate-400">{ad.fiat_currency}</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1 font-mono">
              Limit: {Number(ad.min_limit || 0).toLocaleString()} - {Number(ad.max_limit || 0).toLocaleString()} {ad.fiat_currency}
            </p>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-300">
              {isBuy ? 'I will receive' : 'I will give'}
            </label>
            <div className="mt-1 relative">
              <input
                type="number"
                value={cryptoAmount}
                onChange={(e) => handleCryptoChange(e.target.value)}
                placeholder="0.00"
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-sm focus:outline-none focus:border-indigo-500"
              />
              <span className="absolute right-4 top-3.5 text-xs font-bold text-indigo-400">{ad.asset}</span>
            </div>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <button
          onClick={handleInitiateTrade}
          disabled={submitting}
          className={`w-full py-4 rounded-xl font-bold text-sm shadow-xl transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 ${
            isBuy 
              ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-500 hover:to-teal-500 shadow-emerald-600/20' 
              : 'bg-gradient-to-r from-rose-600 to-pink-600 text-white hover:from-rose-500 hover:to-pink-500 shadow-rose-600/20'
          }`}
        >
          {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShieldCheck className="h-5 w-5" />}
          Initiate Escrow Trade
        </button>
      </div>

      {/* Offer Details & Terms & Conditions Card */}
      <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
          <FileText className="h-4 w-4 text-indigo-400" /> Offer Terms & Conditions
        </h3>

        {ad.offer_tags && ad.offer_tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {ad.offer_tags.map((tag: string, idx: number) => (
              <span key={idx} className="px-2.5 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-xs font-medium flex items-center gap-1">
                <Tag className="h-3 w-3" /> {tag}
              </span>
            ))}
          </div>
        )}

        <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-xs text-slate-300 leading-relaxed whitespace-pre-line">
          {ad.terms_conditions || ad.terms || 'No specific terms specified by the seller. Standard platform trading guidelines apply.'}
        </div>
      </div>
    </div>
  );
}
