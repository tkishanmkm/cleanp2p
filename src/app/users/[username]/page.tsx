"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Star, Lock, Unlock, ThumbsUp, ThumbsDown, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import type { P2PAd, CryptoCurrency } from '@/lib/types';
import { AdCard } from '@/components/p2p/ad-card';

export default function PublicUserProfile() {
  const params = useParams();
  const rawUsername = Array.isArray(params?.username) ? params.username[0] : params?.username;
  const username = rawUsername || '';

  const [profile, setProfile] = useState<any>(null);
  const [blockStatus, setBlockStatus] = useState<string>('NOT_BLOCKED');
  const [loading, setLoading] = useState(true);
  const [blockLoading, setBlockLoading] = useState(false);
  const [ads, setAds] = useState<P2PAd[]>([]);
  const [adsLoading, setAdsLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!username) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/user/profile?username=${encodeURIComponent(username)}`);
      const data = await res.json();
      if (data.profile) {
        setProfile(data.profile);
        setBlockStatus(data.blockStatus || 'NOT_BLOCKED');

        // Fetch active ads for this trader
        if (data.profile.id) {
          setAdsLoading(true);
          const { data: userAds } = await supabase
            .from('p2p_ads')
            .select('*')
            .or(`user_id.eq.${data.profile.id},userId.eq.${data.profile.id}`)
            .eq('active', true)
            .order('created_at', { ascending: false });

          if (userAds) {
            const mapped: P2PAd[] = userAds.map((raw: any) => ({
              id: raw.id,
              userId: raw.user_id || raw.userId,
              publicAdId: raw.public_ad_id || raw.publicAdId || raw.id,
              adType: (raw.ad_type || raw.adType || 'sell') as 'buy' | 'sell',
              crypto: raw.crypto as CryptoCurrency,
              fiatCurrency: raw.fiat_currency || raw.fiatCurrency || 'USD',
              rateType: raw.rate_type || raw.rateType || 'market',
              fixedRate: raw.fixed_rate ?? raw.fixedRate,
              ratePercent: raw.rate_percent ?? raw.ratePercent ?? 0,
              minAmount: Number(raw.min_amount ?? raw.minAmount ?? 0),
              maxAmount: Number(raw.max_amount ?? raw.maxAmount ?? 0),
              paymentMethods: Array.isArray(raw.payment_methods)
                ? raw.payment_methods
                : Array.isArray(raw.paymentMethods)
                ? raw.paymentMethods
                : typeof raw.payment_methods === 'string'
                ? JSON.parse(raw.payment_methods)
                : [],
              terms: raw.terms || '',
              active: raw.active !== false,
              createdAt: raw.created_at || raw.createdAt,
            }));
            setAds(mapped);
          }
          setAdsLoading(false);
        }
      }
    } catch (err) {
      console.error('Failed to load profile:', err);
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleBlockToggle = async () => {
    if (!profile?.id) return;
    setBlockLoading(true);
    const action = (blockStatus === 'YOU_BLOCKED_THIS_USER' || blockStatus === 'BLOCKED_BOTH_WAYS') ? 'UNBLOCK' : 'BLOCK';
    try {
      const res = await fetch('/api/user/block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: profile.id, action }),
      });

      if (res.ok) {
        setBlockStatus(action === 'BLOCK' ? 'YOU_BLOCKED_THIS_USER' : 'NOT_BLOCKED');
      }
    } catch (e) {
      console.error('Block toggle failed:', e);
    } finally {
      setBlockLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
        <p className="text-sm text-slate-400 font-medium">Loading profile...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-xl mx-auto my-12 p-8 text-center rounded-3xl bg-slate-900 border border-slate-800 text-rose-400 space-y-2">
        <p className="text-lg font-bold">User Not Found</p>
        <p className="text-sm text-slate-400">The user &ldquo;{username}&rdquo; does not exist on Paxones.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 lg:p-8 space-y-8">
      {/* Profile Header Card */}
      <div className="p-6 sm:p-8 rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="h-20 w-20 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-600 flex items-center justify-center font-bold text-white text-3xl shadow-lg shrink-0">
            {(profile.username || 'U').charAt(0).toUpperCase()}
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-extrabold text-white">@{profile.username}</h1>
              <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-xs font-semibold">
                {profile.preferred_currency || 'USD'}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Joined {profile.created_at ? new Date(profile.created_at).toLocaleDateString() : 'Recently'}
            </p>

            <div className="pt-2">
              {blockStatus === 'NOT_BLOCKED' && <span className="text-xs text-slate-500">Status: Not Blocked</span>}
              {blockStatus === 'YOU_BLOCKED_THIS_USER' && <span className="text-xs text-amber-400 font-semibold">You Blocked This User</span>}
              {blockStatus === 'THIS_USER_BLOCKED_YOU' && <span className="text-xs text-amber-400 font-semibold">This User Blocked You</span>}
              {blockStatus === 'BLOCKED_BOTH_WAYS' && <span className="text-xs text-rose-400 font-semibold">Blocked Both Ways</span>}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleBlockToggle}
          disabled={blockLoading}
          className={`px-6 py-3 rounded-xl font-semibold text-xs flex items-center gap-2 transition-all cursor-pointer ${
            blockStatus === 'YOU_BLOCKED_THIS_USER' || blockStatus === 'BLOCKED_BOTH_WAYS'
              ? 'bg-slate-800 hover:bg-slate-700 text-white'
              : 'bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/30'
          }`}
        >
          {blockLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (blockStatus === 'YOU_BLOCKED_THIS_USER' || blockStatus === 'BLOCKED_BOTH_WAYS') ? (
            <><Unlock className="h-4 w-4" /> Unblock User</>
          ) : (
            <><Lock className="h-4 w-4" /> Block User</>
          )}
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-1">
          <p className="text-xs text-slate-400">Overall Rating</p>
          <p className="text-2xl font-black text-amber-400 flex items-center justify-center gap-1">
            <Star className="h-5 w-5 fill-amber-400" /> {typeof profile.rating === 'number' ? profile.rating.toFixed(1) : (profile.rating || '5.0')}
          </p>
        </div>
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-1">
          <p className="text-xs text-slate-400">Completed Trades</p>
          <p className="text-2xl font-black text-white">{profile.completed_trades || 0}</p>
        </div>
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-1">
          <p className="text-xs text-slate-400">Positive Feedback</p>
          <p className="text-2xl font-black text-emerald-400">{profile.positive_feedback_pct ?? 100}%</p>
        </div>
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-1">
          <p className="text-xs text-slate-400">Default Currency</p>
          <p className="text-2xl font-black text-indigo-400">{profile.preferred_currency || 'USD'}</p>
        </div>
      </div>

      {/* Active Listings Section */}
      <div className="space-y-4 pt-2">
        <div className="flex items-center justify-between border-b border-border/40 pb-3">
          <h2 className="text-lg font-bold text-foreground">
            Active Offers by @{profile.username}
          </h2>
          <span className="text-xs text-muted-foreground font-mono">
            {ads.length} {ads.length === 1 ? 'offer' : 'offers'} active
          </span>
        </div>

        {adsLoading ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="h-6 w-6 text-indigo-500 animate-spin" />
          </div>
        ) : ads.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ads.map((ad) => (
              <AdCard key={ad.id} ad={ad} />
            ))}
          </div>
        ) : (
          <div className="p-8 text-center rounded-2xl bg-card border border-border text-muted-foreground text-sm">
            This user does not currently have any active public buy or sell offers.
          </div>
        )}
      </div>
    </div>
  );
}
