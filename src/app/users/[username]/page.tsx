"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { 
  Star, 
  Lock, 
  Unlock, 
  ThumbsUp, 
  ThumbsDown, 
  Loader2, 
  CheckCircle2, 
  ShieldCheck, 
  MailCheck, 
  MessageSquare,
  Clock,
  UserCheck
} from 'lucide-react';
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
  const [feedbacks, setFeedbacks] = useState<any[]>([]);
  const [feedbackTab, setFeedbackTab] = useState<'received' | 'given'>('received');

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
            .or('is_active.eq.true,active.eq.true')
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

          // Fetch user feedback
          const { data: fbData } = await supabase
            .from('trade_feedback')
            .select(`
              id,
              trade_id,
              reviewer_id,
              reviewee_id,
              rating,
              feedback_type,
              comment,
              created_at,
              reviewer:profiles!trade_feedback_reviewer_id_fkey(username, avatar_url),
              reviewee:profiles!trade_feedback_reviewee_id_fkey(username, avatar_url)
            `)
            .or(`reviewee_id.eq.${data.profile.id},reviewer_id.eq.${data.profile.id}`)
            .order('created_at', { ascending: false })
            .limit(20);

          if (fbData) {
            setFeedbacks(fbData);
          }
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
        <Loader2 className="h-8 w-8 text-amber-500 animate-spin" />
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

  const isEmailVerified = Boolean(profile.is_email_verified ?? true);
  const isIdVerified = Boolean(profile.is_id_verified || profile.kyc_status === 'VERIFIED' || profile.verification_tier === 2);

  const receivedFeedbacks = feedbacks.filter((f) => f.reviewee_id === profile.id);
  const givenFeedbacks = feedbacks.filter((f) => f.reviewer_id === profile.id);
  const displayedFeedbacks = feedbackTab === 'received' ? receivedFeedbacks : givenFeedbacks;

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 lg:p-8 space-y-8">
      {/* Profile Header Card */}
      <div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="relative h-20 w-20 rounded-2xl overflow-hidden bg-gradient-to-tr from-amber-500 to-amber-600 flex items-center justify-center font-bold text-white text-3xl shadow-lg shrink-0 border border-slate-200 dark:border-slate-700">
            {profile.avatar_url || profile.photo_url ? (
              <img
                src={profile.avatar_url || profile.photo_url || `/api/media/avatar/${profile.id}`}
                alt={profile.username}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <span>{(profile.username || 'U').charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">@{profile.username}</h1>
              <span className="px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs font-semibold">
                {profile.preferred_currency || profile.preferred_fiat || 'USD'}
              </span>
            </div>

            {/* Verification Badges */}
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {isEmailVerified && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  <MailCheck className="h-3 w-3" />
                  Email Verified
                </span>
              )}
              {isIdVerified ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                  <ShieldCheck className="h-3 w-3" />
                  ID Verified
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                  Tier 1 Trader
                </span>
              )}
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 pt-0.5">
              Member since {profile.created_at ? new Date(profile.created_at).toLocaleDateString() : 'Recently'}
            </p>

            <div className="pt-1">
              {blockStatus === 'YOU_BLOCKED_THIS_USER' && (
                <span className="text-xs text-amber-500 font-semibold bg-amber-500/10 px-2 py-0.5 rounded">You Blocked This User</span>
              )}
              {blockStatus === 'THIS_USER_BLOCKED_YOU' && (
                <span className="text-xs text-amber-500 font-semibold bg-amber-500/10 px-2 py-0.5 rounded">This User Blocked You</span>
              )}
              {blockStatus === 'BLOCKED_BOTH_WAYS' && (
                <span className="text-xs text-rose-500 font-semibold bg-rose-500/10 px-2 py-0.5 rounded">Blocked Both Ways</span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleBlockToggle}
          disabled={blockLoading}
          className={`px-6 py-3 rounded-xl font-semibold text-xs flex items-center gap-2 transition-all cursor-pointer ${
            blockStatus === 'YOU_BLOCKED_THIS_USER' || blockStatus === 'BLOCKED_BOTH_WAYS'
              ? 'bg-slate-800 hover:bg-slate-700 text-white shadow-sm'
              : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30'
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
        <div className="p-5 rounded-2xl bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] text-center space-y-1">
          <p className="text-xs text-slate-500 dark:text-slate-400">Overall Rating</p>
          <p className="text-2xl font-black text-amber-500 flex items-center justify-center gap-1">
            <Star className="h-5 w-5 fill-amber-500" /> {typeof profile.rating === 'number' ? profile.rating.toFixed(1) : (profile.rating || '5.0')}
          </p>
        </div>
        <div className="p-5 rounded-2xl bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] text-center space-y-1">
          <p className="text-xs text-slate-500 dark:text-slate-400">Completed Trades</p>
          <p className="text-2xl font-black text-slate-900 dark:text-white">{profile.completed_trades || 0}</p>
        </div>
        <div className="p-5 rounded-2xl bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] text-center space-y-1">
          <p className="text-xs text-slate-500 dark:text-slate-400">Positive Feedback</p>
          <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{profile.positive_feedback_pct ?? 100}%</p>
        </div>
        <div className="p-5 rounded-2xl bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] text-center space-y-1">
          <p className="text-xs text-slate-500 dark:text-slate-400">Default Currency</p>
          <p className="text-2xl font-black text-slate-900 dark:text-white">{profile.preferred_currency || profile.preferred_fiat || 'USD'}</p>
        </div>
      </div>

      {/* Active Listings Section */}
      <div className="space-y-4 pt-2">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#1e2640] pb-3">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            Active Offers by @{profile.username}
          </h2>
          <span className="text-xs text-slate-500 font-mono">
            {ads.length} {ads.length === 1 ? 'offer' : 'offers'} active
          </span>
        </div>

        {adsLoading ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="h-6 w-6 text-amber-500 animate-spin" />
          </div>
        ) : ads.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ads.map((ad) => (
              <AdCard key={ad.id} ad={ad} />
            ))}
          </div>
        ) : (
          <div className="p-8 text-center rounded-2xl bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] text-slate-500 text-sm">
            This user does not currently have any active public buy or sell offers.
          </div>
        )}
      </div>

      {/* Trader Feedback Section */}
      <div className="space-y-4 pt-4">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#1e2640] pb-3">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-amber-500" />
            <span>Trader Reviews & Feedback</span>
          </h2>

          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs">
            <button
              type="button"
              onClick={() => setFeedbackTab('received')}
              className={`px-3 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                feedbackTab === 'received' 
                  ? 'bg-white dark:bg-[#0f1423] text-slate-900 dark:text-white shadow-sm' 
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Received ({receivedFeedbacks.length})
            </button>
            <button
              type="button"
              onClick={() => setFeedbackTab('given')}
              className={`px-3 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                feedbackTab === 'given' 
                  ? 'bg-white dark:bg-[#0f1423] text-slate-900 dark:text-white shadow-sm' 
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Given ({givenFeedbacks.length})
            </button>
          </div>
        </div>

        {displayedFeedbacks.length === 0 ? (
          <div className="p-8 text-center rounded-2xl bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] text-slate-500 text-sm">
            No feedback entries found for this category.
          </div>
        ) : (
          <div className="space-y-3">
            {displayedFeedbacks.map((fb) => {
              const counterparty = feedbackTab === 'received' ? fb.reviewer : fb.reviewee;
              const isPositive = fb.feedback_type === 'POSITIVE' || (fb.rating && fb.rating >= 4);

              return (
                <div 
                  key={fb.id} 
                  className="p-4 rounded-2xl bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] flex items-start gap-3.5"
                >
                  <div className={`p-2 rounded-xl shrink-0 ${isPositive ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'}`}>
                    {isPositive ? <ThumbsUp className="h-4 w-4" /> : <ThumbsDown className="h-4 w-4" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold text-slate-900 dark:text-white">
                        @{counterparty?.username || 'Trader'}
                      </p>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {fb.created_at ? new Date(fb.created_at).toLocaleDateString() : ''}
                      </span>
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                      {fb.comment || (isPositive ? 'Smooth and fast escrow trade.' : 'Trade dispute encountered.')}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
