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
  ShieldCheck, 
  MailCheck, 
  MessageSquare,
  Clock,
  ShieldBan,
  UserX,
  Coins,
  ArrowDownLeft,
  ArrowUpRight,
  TrendingUp,
  Award,
  Zap,
  CheckCircle2
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import type { P2PAd, CryptoCurrency } from '@/lib/types';
import { AdCard } from '@/components/p2p/ad-card';
import { MerchantBadge } from '@/components/merchant/merchant-badge';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

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
  const [adsTab, setAdsTab] = useState<'buy' | 'sell'>('sell');
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

        // Fetch active ads for this trader (excluding deleted/inactive)
        if (data.profile.id) {
          setAdsLoading(true);
          const { data: userAds } = await supabase
            .from('p2p_ads')
            .select('*')
            .or(`user_id.eq.${data.profile.id},userId.eq.${data.profile.id}`)
            .or('is_active.eq.true,active.eq.true')
            .order('created_at', { ascending: false });

          if (userAds) {
            const mapped: P2PAd[] = userAds
              .filter((raw: any) => raw.status !== 'DELETED' && raw.status !== 'deleted')
              .map((raw: any) => ({
                id: raw.id,
                userId: raw.user_id || raw.userId,
                publicAdId: raw.public_ad_id || raw.publicAdId || raw.id,
                adType: (raw.ad_type || raw.adType || 'sell').toLowerCase() as 'buy' | 'sell',
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
                active: raw.active !== false && raw.is_active !== false,
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
            .limit(30);

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
        loadData();
      }
    } catch (e) {
      console.error('Block toggle failed:', e);
    } finally {
      setBlockLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-9 w-9 text-amber-500 animate-spin" />
        <p className="text-sm text-slate-400 font-medium">Loading verified trader profile...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-xl mx-auto my-16 p-8 text-center rounded-3xl bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] shadow-xl text-rose-500 space-y-3">
        <UserX className="h-12 w-12 mx-auto text-rose-500/80" />
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Trader Not Found</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">The requested user &ldquo;{username}&rdquo; does not exist or has been deactivated.</p>
      </div>
    );
  }

  const isEmailVerified = Boolean(profile.is_email_verified ?? true);
  const isIdVerified = Boolean(profile.is_id_verified || profile.kyc_status === 'VERIFIED' || profile.verification_tier === 2 || profile.verification_tier === 'TIER_2');

  const receivedFeedbacks = feedbacks.filter((f) => f.reviewee_id === profile.id);
  const givenFeedbacks = feedbacks.filter((f) => f.reviewer_id === profile.id);
  const displayedFeedbacks = feedbackTab === 'received' ? receivedFeedbacks : givenFeedbacks;

  // Filter ads by buy/sell tab
  const filteredAds = ads.filter((ad) => ad.adType === adsTab);

  const avgPayFormatted = profile.avg_pay_time || (profile.avg_pay_time_seconds ? `${profile.avg_pay_time_seconds}s` : 'N/A');
  const avgReleaseFormatted = profile.avg_release_time || (profile.avg_release_time_seconds ? `${profile.avg_release_time_seconds}s` : 'N/A');

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8 space-y-8">
      {/* Primary Header Card */}
      <div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative overflow-hidden">
        <div className="flex items-center gap-5">
          <div className="relative h-20 w-20 sm:h-24 sm:w-24 rounded-2xl overflow-hidden bg-gradient-to-tr from-amber-500 to-amber-600 flex items-center justify-center font-bold text-white text-3xl sm:text-4xl shadow-lg shrink-0 border-2 border-amber-500/30">
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
              <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                @{profile.username}
              </h1>

              {/* Merchant Tier Badge */}
              <MerchantBadge tier={profile.merchant_tier} size="md" />

              {/* Preferred Currency Badge */}
              <Badge variant="outline" className="bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400 font-bold px-2.5 py-0.5">
                {profile.preferred_currency || profile.preferred_fiat || 'USD'}
              </Badge>
            </div>

            {/* Account Verification Badges */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {isEmailVerified && (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  <MailCheck className="h-3.5 w-3.5" />
                  Email Verified
                </span>
              )}
              {isIdVerified ? (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  ID Verified / KYC Passed
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                  Standard Trader
                </span>
              )}
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 pt-0.5 font-medium">
              Registered trader since {profile.created_at ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric', day: 'numeric' }) : 'Recently'}
            </p>

            {/* Block Warnings */}
            {blockStatus !== 'NOT_BLOCKED' && (
              <div className="pt-1.5">
                {blockStatus === 'YOU_BLOCKED_THIS_USER' && (
                  <span className="text-xs text-amber-500 font-semibold bg-amber-500/10 px-2.5 py-1 rounded-lg inline-flex items-center gap-1 border border-amber-500/20">
                    <ShieldBan className="h-3.5 w-3.5" /> You have blocked this user
                  </span>
                )}
                {blockStatus === 'THIS_USER_BLOCKED_YOU' && (
                  <span className="text-xs text-amber-500 font-semibold bg-amber-500/10 px-2.5 py-1 rounded-lg inline-flex items-center gap-1 border border-amber-500/20">
                    <ShieldBan className="h-3.5 w-3.5" /> This user has blocked you
                  </span>
                )}
                {blockStatus === 'BLOCKED_BOTH_WAYS' && (
                  <span className="text-xs text-rose-500 font-semibold bg-rose-500/10 px-2.5 py-1 rounded-lg inline-flex items-center gap-1 border border-rose-500/20">
                    <ShieldBan className="h-3.5 w-3.5" /> Blocked Both Ways
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Header Action Button */}
        <div className="flex items-center gap-3 self-stretch md:self-auto">
          <button
            type="button"
            onClick={handleBlockToggle}
            disabled={blockLoading}
            className={`w-full md:w-auto px-6 py-3 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm ${
              blockStatus === 'YOU_BLOCKED_THIS_USER' || blockStatus === 'BLOCKED_BOTH_WAYS'
                ? 'bg-slate-800 hover:bg-slate-700 text-white'
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
      </div>

      {/* Grid of Key Platform Metrics & Statistics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5 sm:gap-4">
        {/* Positive Feedback */}
        <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] text-center space-y-1.5 shadow-sm">
          <div className="flex items-center justify-center gap-1 text-emerald-600 dark:text-emerald-400">
            <ThumbsUp className="h-4 w-4" />
            <span className="text-xs font-bold">Positive</span>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-emerald-600 dark:text-emerald-400">
            {profile.positive_feedback || 0}
          </p>
          <p className="text-[11px] text-slate-400">{profile.positive_feedback_pct ?? 100}% positive</p>
        </div>

        {/* Negative Feedback */}
        <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] text-center space-y-1.5 shadow-sm">
          <div className="flex items-center justify-center gap-1 text-rose-500">
            <ThumbsDown className="h-4 w-4" />
            <span className="text-xs font-bold">Negative</span>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-rose-500">
            {profile.negative_feedback || 0}
          </p>
          <p className="text-[11px] text-slate-400">{profile.completed_trades || 0} total trades</p>
        </div>

        {/* Calculated Avg Pay Time */}
        <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] text-center space-y-1.5 shadow-sm">
          <div className="flex items-center justify-center gap-1 text-amber-500">
            <Zap className="h-4 w-4" />
            <span className="text-xs font-bold">Avg Pay Time</span>
          </div>
          <p className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
            {avgPayFormatted}
          </p>
          <p className="text-[11px] text-slate-400">Buyer speed metric</p>
        </div>

        {/* Calculated Avg Release Time */}
        <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] text-center space-y-1.5 shadow-sm">
          <div className="flex items-center justify-center gap-1 text-blue-500">
            <Clock className="h-4 w-4" />
            <span className="text-xs font-bold">Avg Release</span>
          </div>
          <p className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
            {avgReleaseFormatted}
          </p>
          <p className="text-[11px] text-slate-400">Seller release speed</p>
        </div>

        {/* Blocked by X users */}
        <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] text-center space-y-1.5 shadow-sm">
          <div className="flex items-center justify-center gap-1 text-slate-500 dark:text-slate-400">
            <ShieldBan className="h-4 w-4 text-rose-400" />
            <span className="text-xs font-bold">Blocked By</span>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">
            {profile.blocked_by_count ?? 0}
          </p>
          <p className="text-[11px] text-slate-400">traders</p>
        </div>

        {/* Has blocked X users */}
        <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] text-center space-y-1.5 shadow-sm">
          <div className="flex items-center justify-center gap-1 text-slate-500 dark:text-slate-400">
            <UserX className="h-4 w-4 text-slate-400" />
            <span className="text-xs font-bold">Has Blocked</span>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">
            {profile.blocking_count ?? (Array.isArray(profile.blocked_users) ? profile.blocked_users.length : 0)}
          </p>
          <p className="text-[11px] text-slate-400">users</p>
        </div>
      </div>

      {/* Active Listings Section with Buy/Sell Tabs */}
      <div className="space-y-4 pt-2">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-slate-200 dark:border-[#1e2640] pb-4 gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
              <Coins className="h-5 w-5 text-amber-500" />
              <span>Active Marketplace Listings</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Live peer-to-peer offers posted by @{profile.username}
            </p>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setAdsTab('sell')}
              className={cn(
                'px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5',
                adsTab === 'sell'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              )}
            >
              <ArrowDownLeft className="h-3.5 w-3.5" />
              <span>Sell Crypto ({ads.filter((a) => a.adType === 'sell').length})</span>
            </button>
            <button
              type="button"
              onClick={() => setAdsTab('buy')}
              className={cn(
                'px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5',
                adsTab === 'buy'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              )}
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
              <span>Buy Crypto ({ads.filter((a) => a.adType === 'buy').length})</span>
            </button>
          </div>
        </div>

        {adsLoading ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="h-8 w-8 text-amber-500 animate-spin" />
          </div>
        ) : filteredAds.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredAds.map((ad) => (
              <AdCard key={ad.id} ad={ad} />
            ))}
          </div>
        ) : (
          <div className="p-10 text-center rounded-3xl bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] text-slate-500 text-sm space-y-1">
            <p className="font-semibold text-slate-700 dark:text-slate-300">No active {adsTab.toUpperCase()} listings right now.</p>
            <p className="text-xs text-slate-400">Check back later or explore other marketplace offers.</p>
          </div>
        )}
      </div>

      {/* Trader Reviews & Feedback Section */}
      <div className="space-y-4 pt-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-slate-200 dark:border-[#1e2640] pb-4 gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-amber-500" />
              <span>Trader Reviews & Feedback</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Verified trade feedback submitted by counterparties
            </p>
          </div>

          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
            <button
              type="button"
              onClick={() => setFeedbackTab('received')}
              className={cn(
                'px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer',
                feedbackTab === 'received' 
                  ? 'bg-white dark:bg-[#0f1423] text-slate-900 dark:text-white shadow-sm' 
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              )}
            >
              Received ({receivedFeedbacks.length})
            </button>
            <button
              type="button"
              onClick={() => setFeedbackTab('given')}
              className={cn(
                'px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer',
                feedbackTab === 'given' 
                  ? 'bg-white dark:bg-[#0f1423] text-slate-900 dark:text-white shadow-sm' 
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              )}
            >
              Given ({givenFeedbacks.length})
            </button>
          </div>
        </div>

        {displayedFeedbacks.length === 0 ? (
          <div className="p-10 text-center rounded-3xl bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] text-slate-500 text-sm">
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
                  className="p-5 rounded-2xl bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] flex items-start gap-4 shadow-sm"
                >
                  <div className={cn(
                    'p-2.5 rounded-xl shrink-0',
                    isPositive 
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20' 
                      : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                  )}>
                    {isPositive ? <ThumbsUp className="h-4 w-4" /> : <ThumbsDown className="h-4 w-4" />}
                  </div>

                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold text-slate-900 dark:text-white">
                        @{counterparty?.username || 'Verified Trader'}
                      </p>
                      <span className="text-[11px] text-slate-400 font-mono">
                        {fb.created_at ? new Date(fb.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                      </span>
                    </div>

                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed font-normal">
                      {fb.comment || (isPositive ? 'Smooth, reliable and fast escrow trade.' : 'Encountered delays during trade verification.')}
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
