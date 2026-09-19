'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  CheckCircle2,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Globe,
  TrendingUp,
  CheckCircle,
  ThumbsUp,
  ThumbsDown,
  ArrowUpRight,
  Coins,
  CreditCard,
  MessageSquare,
  Award,
  DollarSign,
  Zap,
} from 'lucide-react';
import UserAvatar from '@/components/common/UserAvatar';
import { getPresenceStatus, formatJoinedDate, usePresenceStatus } from '@/lib/presence';
import { createClient } from '@/utils/supabase/client';
import { countries } from '@/lib/countries';

interface UserProfileClientProps {
  profile: {
    id: string;
    username: string;
    full_name?: string | null;
    avatar_url?: string | null;
    country?: string | null;
    is_email_verified?: boolean;
    is_id_verified?: boolean;
    kyc_status?: string | null;
    created_at?: string | null;
    last_seen_at?: string | null;
    last_seen?: string | null;
    merchant_tier?: string | null;
    bio?: string | null;
  };
  buyAds: any[];
  sellAds: any[];
  receivedFeedbacks: any[];
  givenFeedbacks: any[];
  stats: {
    completedTrades: number;
    tradeVolumeUSD: number;
    avgPayTimeSeconds: number | null;
    avgReleaseTimeSeconds: number | null;
    positiveFeedbacksCount: number;
    negativeFeedbacksCount: number;
    positiveRatio: string;
    totalFeedbackCount: number;
    blockedBy?: number;
    hasBlocked?: number;
  };
}

const FIAT_COUNTRY_CODES: Record<string, string> = {
  USD: 'us',
  EUR: 'eu',
  GBP: 'gb',
  INR: 'in',
  CAD: 'ca',
  AUD: 'au',
  JPY: 'jp',
  CNY: 'cn',
  CHF: 'ch',
  HKD: 'hk',
  NZD: 'nz',
  SEK: 'se',
  KRW: 'kr',
  SGD: 'sg',
  NOK: 'no',
  MXN: 'mx',
  RUB: 'ru',
  ZAR: 'za',
  TRY: 'tr',
  BRL: 'br',
  AED: 'ae',
  PKR: 'pk',
  BDT: 'bd',
  NGN: 'ng',
  PHP: 'ph',
  IDR: 'id',
  VND: 'vn',
  AFN: 'af',
  ALL: 'al',
  DZD: 'dz',
  AOA: 'ao',
  ARS: 'ar',
  AMD: 'am',
  AZN: 'az',
  BHD: 'bh',
  BYN: 'by',
  BAM: 'ba',
  BWP: 'bw',
  BGN: 'bg',
  CLP: 'cl',
  COP: 'co',
  CRC: 'cr',
  CZK: 'cz',
  DKK: 'dk',
  EGP: 'eg',
  GEL: 'ge',
  GHS: 'gh',
  HUF: 'hu',
  ILS: 'il',
  JOD: 'jo',
  KZT: 'kz',
  KES: 'ke',
  KWD: 'kw',
  LKR: 'lk',
  MAD: 'ma',
  MYR: 'my',
  NPR: 'np',
  OMR: 'om',
  PEN: 'pe',
  PLN: 'pl',
  QAR: 'qa',
  RON: 'ro',
  RSD: 'rs',
  SAR: 'sa',
  TWD: 'tw',
  TZS: 'tz',
  THB: 'th',
  UAH: 'ua',
  UGX: 'ug',
  UZS: 'uz',
};

function getCountryDetails(countryCodeOrName: string | null | undefined) {
  if (!countryCodeOrName) {
    return { name: 'Global', code: 'us', flagUrl: 'https://flagcdn.com/w40/us.png' };
  }
  const clean = countryCodeOrName.trim().toUpperCase();
  const match = countries.find(
    (c) => c.code.toUpperCase() === clean || c.name.toUpperCase() === clean
  );

  const code = match ? match.code.toLowerCase() : clean.length === 2 ? clean.toLowerCase() : 'us';
  const name = match ? match.name : countryCodeOrName;

  return {
    name,
    code,
    flagUrl: `https://flagcdn.com/w40/${code}.png`,
  };
}

function getFiatFlagUrl(fiat: string): string {
  const code = FIAT_COUNTRY_CODES[fiat?.toUpperCase()] || 'us';
  return `https://flagcdn.com/w40/${code.toLowerCase()}.png`;
}

function formatDurationSeconds(seconds: number | null | undefined): string {
  if (seconds == null || isNaN(seconds) || seconds <= 0) return 'N/A';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min${minutes > 1 ? 's' : ''}`;
  const hours = (seconds / 3600).toFixed(1);
  return `${hours} hr${Number(hours) > 1 ? 's' : ''}`;
}

function formatVolumeUSD(amount: number | null | undefined): string {
  const val = Number(amount) || 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
}

function parsePaymentMethods(methods: any): string[] {
  if (Array.isArray(methods)) return methods;
  if (typeof methods === 'string') {
    try {
      const parsed = JSON.parse(methods);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    return methods.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return ['Bank Transfer'];
}

export default function UserProfileClient({
  profile: initialProfile,
  buyAds,
  sellAds,
  receivedFeedbacks,
  givenFeedbacks,
  stats,
}: UserProfileClientProps) {
  const [profile, setProfile] = useState(initialProfile);
  const [activeTab, setActiveTab] = useState<'buy_ads' | 'sell_ads' | 'received' | 'given'>('buy_ads');
  const [feedbackFilter, setFeedbackFilter] = useState<'all' | 'positive' | 'negative'>('all');

  // Keep live profile updated with Supabase realtime & on mount refresh
  useEffect(() => {
    if (!initialProfile?.id) return;
    const supabase = createClient();

    // 1. Fetch latest profile immediately on mount to prevent stale SSR cache
    const fetchLatestProfile = async () => {
      try {
        const { data: latest } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', initialProfile.id)
          .maybeSingle();

        if (latest) {
          setProfile((prev) => ({
            ...prev,
            ...latest,
            last_seen: latest.last_seen || latest.last_seen_at || latest.last_active || prev.last_seen,
            last_seen_at: latest.last_seen_at || latest.last_seen || prev.last_seen_at,
            last_active: latest.last_active || latest.last_seen || prev.last_active,
            is_online: latest.is_online ?? prev.is_online,
          }));
        }
      } catch (err) {
        console.warn('Realtime profile refresh notice:', err);
      }
    };

    fetchLatestProfile();

    // 2. Poll every 15 seconds to ensure active heartbeats show in real-time
    const pollInterval = setInterval(fetchLatestProfile, 15000);

    // 3. Supabase Realtime channel subscription for instant update when heartbeat is written
    const channel = supabase
      .channel(`public:profiles:presence:${initialProfile.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${initialProfile.id}`,
        },
        (payload) => {
          if (payload.new) {
            const updated = payload.new as any;
            setProfile((prev) => ({
              ...prev,
              ...updated,
              last_seen: updated.last_seen || updated.last_seen_at || updated.last_active || prev.last_seen,
              last_seen_at: updated.last_seen_at || updated.last_seen || prev.last_seen_at,
              last_active: updated.last_active || updated.last_seen || prev.last_active,
              is_online: updated.is_online ?? prev.is_online,
            }));
          }
        }
      )
      .subscribe();

    return () => {
      clearInterval(pollInterval);
      supabase.removeChannel(channel);
    };
  }, [initialProfile?.id]);

  const presence = usePresenceStatus(profile, 15000);
  const countryInfo = getCountryDetails(profile.country);

  const cleanUsername = (profile.username || 'User').replace(/^@/, '');

  // Filter feedbacks based on selected filter
  const displayedFeedbacks = (activeTab === 'received' ? receivedFeedbacks : givenFeedbacks).filter((fb) => {
    if (feedbackFilter === 'positive') return fb.is_positive === true;
    if (feedbackFilter === 'negative') return fb.is_positive === false;
    return true;
  });

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10 text-neutral-900 dark:text-neutral-100 min-h-screen">
      {/* Top Trader Profile Card */}
      <div className="p-6 sm:p-8 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200/90 dark:border-neutral-800 shadow-sm mb-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          {/* Avatar & User Identifiers */}
          <div className="flex items-start sm:items-center gap-4 sm:gap-5">
            <div className="relative shrink-0">
              <UserAvatar
                userId={profile.id}
                avatarUrl={profile.avatar_url || (profile as any)?.photo_url}
                username={cleanUsername}
                size="xl"
              />
              <span
                title={presence.label}
                className={`absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-white dark:border-neutral-900 ${
                  presence.isOnline ? 'bg-emerald-500 ring-2 ring-emerald-500/20' : 'bg-neutral-400'
                }`}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-neutral-900 dark:text-white">
                  @{cleanUsername}
                </h1>

                {profile.merchant_tier && profile.merchant_tier !== 'NONE' && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300 dark:border-amber-800/60">
                    <Award className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                    {profile.merchant_tier} Merchant
                  </span>
                )}
              </div>

              {/* Sub-meta: Activity status & Joined relative date */}
              <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-neutral-500 dark:text-neutral-400">
                <span className="flex items-center gap-1 font-medium">
                  <span className={`w-2 h-2 rounded-full ${presence.isOnline ? 'bg-emerald-500' : 'bg-neutral-400'}`} />
                  {presence.label}
                </span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 opacity-70" />
                  {formatJoinedDate(profile.created_at)}
                </span>
              </div>

              {/* Badges: Email Verified, ID Verified, Origin Country */}
              <div className="flex flex-wrap items-center gap-2 pt-2">
                {/* Email Verification Badge */}
                {profile.is_email_verified ? (
                  <span
                    id="badge-email-verified"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/80"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    Email Verified
                  </span>
                ) : (
                  <span
                    id="badge-email-unverified"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-neutral-100 text-neutral-600 dark:bg-neutral-800/80 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700"
                  >
                    Email Unverified
                  </span>
                )}

                {/* ID / KYC Verification Badge */}
                {profile.is_id_verified ? (
                  <span
                    id="badge-id-verified"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200 dark:border-blue-800/80"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    ID Verified
                  </span>
                ) : profile.kyc_status === 'PENDING' ? (
                  <span
                    id="badge-id-pending"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800/80"
                  >
                    <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                    ID Verification Pending
                  </span>
                ) : (
                  <span
                    id="badge-id-unverified"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-neutral-100 text-neutral-600 dark:bg-neutral-800/80 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700"
                  >
                    <ShieldAlert className="w-3.5 h-3.5 opacity-70" />
                    ID Unverified
                  </span>
                )}

                {/* Country of Origin Badge */}
                <span
                  id="badge-country-origin"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-neutral-100 text-neutral-700 dark:bg-neutral-800/80 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700"
                >
                  <img
                    src={countryInfo.flagUrl}
                    alt={countryInfo.name}
                    className="w-4 h-3 object-cover rounded-xs border border-neutral-300 dark:border-neutral-700 shadow-xs"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                  <span>{countryInfo.name}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Quick Trade Count / Rating Summary */}
          <div className="flex sm:flex-col sm:items-end justify-between border-t sm:border-t-0 pt-4 sm:pt-0 border-neutral-200 dark:border-neutral-800 gap-2">
            <div className="text-left sm:text-right">
              <span className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider block">
                Feedback Score
              </span>
              <div className="text-lg sm:text-xl font-bold text-emerald-600 dark:text-emerald-400 flex items-center sm:justify-end gap-1.5">
                <ThumbsUp className="w-4 h-4" />
                <span>{stats.positiveRatio}% Positive</span>
              </div>
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              ({stats.positiveFeedbacksCount} positive / {stats.negativeFeedbacksCount} negative)
            </p>
          </div>
        </div>
      </div>

      {/* Comprehensive Trader Statistics Grid (Direct Database Metrics) */}
      <div className="mb-8">
        <h2 className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
          Trader Key Statistics
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Trade Volume */}
          <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-xs">
            <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400 mb-1.5">
              <span className="text-xs font-medium">Trade Volume</span>
              <DollarSign className="w-4 h-4 text-neutral-400" />
            </div>
            <div className="text-base sm:text-lg font-bold text-neutral-900 dark:text-neutral-100 truncate">
              {formatVolumeUSD(stats.tradeVolumeUSD)}
            </div>
          </div>

          {/* Completed Trades */}
          <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-xs">
            <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400 mb-1.5">
              <span className="text-xs font-medium">Completed Trades</span>
              <CheckCircle className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="text-base sm:text-lg font-bold text-neutral-900 dark:text-neutral-100">
              {stats.completedTrades}
            </div>
          </div>

          {/* Avg Paid */}
          <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-xs">
            <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400 mb-1.5">
              <span className="text-xs font-medium">Avg Paid Time</span>
              <Zap className="w-4 h-4 text-amber-500" />
            </div>
            <div className="text-base sm:text-lg font-bold text-neutral-900 dark:text-neutral-100">
              {formatDurationSeconds(stats.avgPayTimeSeconds)}
            </div>
          </div>

          {/* Avg Release */}
          <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-xs">
            <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400 mb-1.5">
              <span className="text-xs font-medium">Avg Release Time</span>
              <Clock className="w-4 h-4 text-blue-500" />
            </div>
            <div className="text-base sm:text-lg font-bold text-neutral-900 dark:text-neutral-100">
              {formatDurationSeconds(stats.avgReleaseTimeSeconds)}
            </div>
          </div>

          {/* Country Origin */}
          <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-xs">
            <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400 mb-1.5">
              <span className="text-xs font-medium">Country Origin</span>
              <Globe className="w-4 h-4 text-neutral-400" />
            </div>
            <div className="flex items-center gap-1.5 text-sm sm:text-base font-bold text-neutral-900 dark:text-neutral-100 truncate">
              <img
                src={countryInfo.flagUrl}
                alt={countryInfo.name}
                className="w-4 h-3 object-cover rounded-xs border border-neutral-300 dark:border-neutral-700 shrink-0"
              />
              <span className="truncate">{countryInfo.code.toUpperCase()}</span>
            </div>
          </div>

          {/* Positive Rating */}
          <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-xs">
            <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400 mb-1.5">
              <span className="text-xs font-medium">Positive Rating</span>
              <TrendingUp className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="text-base sm:text-lg font-bold text-emerald-600 dark:text-emerald-400">
              {stats.positiveRatio}%
            </div>
          </div>
        </div>
      </div>

      {/* Main Tab Navigation Bar */}
      <div className="border-b border-neutral-200 dark:border-neutral-800 mb-6 overflow-x-auto">
        <div className="flex gap-2 sm:gap-6 min-w-max">
          <button
            id="tab-buy-ads"
            onClick={() => setActiveTab('buy_ads')}
            className={`pb-3.5 px-2 text-sm font-semibold transition-all relative flex items-center gap-2 cursor-pointer ${
              activeTab === 'buy_ads'
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
            }`}
          >
            <span>Buy Ads</span>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300">
              {buyAds.length}
            </span>
          </button>

          <button
            id="tab-sell-ads"
            onClick={() => setActiveTab('sell_ads')}
            className={`pb-3.5 px-2 text-sm font-semibold transition-all relative flex items-center gap-2 cursor-pointer ${
              activeTab === 'sell_ads'
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
            }`}
          >
            <span>Sell Ads</span>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300">
              {sellAds.length}
            </span>
          </button>

          <button
            id="tab-received-feedback"
            onClick={() => setActiveTab('received')}
            className={`pb-3.5 px-2 text-sm font-semibold transition-all relative flex items-center gap-2 cursor-pointer ${
              activeTab === 'received'
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
            }`}
          >
            <span>Feedback Received</span>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300">
              {receivedFeedbacks.length}
            </span>
          </button>

          <button
            id="tab-given-feedback"
            onClick={() => setActiveTab('given')}
            className={`pb-3.5 px-2 text-sm font-semibold transition-all relative flex items-center gap-2 cursor-pointer ${
              activeTab === 'given'
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
            }`}
          >
            <span>Feedback Given</span>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300">
              {givenFeedbacks.length}
            </span>
          </button>
        </div>
      </div>

      {/* Tab 1: Buy Ads List (Visitor BUYS from advertiser) */}
      {activeTab === 'buy_ads' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-neutral-900 dark:text-white">
              Buy Offers from @{cleanUsername}
            </h3>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {buyAds.length} active offer{buyAds.length !== 1 ? 's' : ''} (Buy crypto from @{cleanUsername})
            </span>
          </div>

          {buyAds.length > 0 ? (
            <div className="grid grid-cols-1 gap-3.5">
              {buyAds.map((ad) => {
                const asset = (ad.asset_symbol || ad.crypto || ad.asset || 'USDT').toUpperCase();
                const fiat = (ad.fiat_symbol || ad.fiat || ad.fiat_currency || 'USD').toUpperCase();
                const minLimit = Number(ad.min_limit ?? ad.min_amount ?? 10);
                const maxLimit = Number(ad.max_limit ?? ad.max_amount ?? 5000);
                const price = Number(ad.price || ad.unit_price || 0);
                const paymentMethods = parsePaymentMethods(ad.payment_methods);

                // Compute effectiveMaxLimit capped by advertiser's crypto balance
                const availCrypto = Number(ad.available_crypto ?? -1);
                let effectiveMaxLimit = maxLimit;
                if (availCrypto >= 0 && price > 0) {
                  const availFiat = availCrypto * price;
                  if (availFiat > 0) {
                    effectiveMaxLimit = maxLimit > 0 ? Math.min(maxLimit, availFiat) : availFiat;
                  }
                }

                return (
                  <div
                    key={ad.id}
                    id={`ad-buy-${ad.id}`}
                    className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 hover:border-neutral-300 dark:hover:border-neutral-700 transition-all flex flex-col md:flex-row md:items-center justify-between gap-5"
                  >
                    {/* Left: Asset & Order Details */}
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800/60">
                          BUY {asset}
                        </span>
                        <span className="text-xs text-neutral-500 dark:text-neutral-400">
                          Order Limit:{' '}
                          <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                            {minLimit.toLocaleString()} - {effectiveMaxLimit.toLocaleString()} {fiat}
                          </span>
                        </span>
                      </div>

                      {/* Payment Methods Pills */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <CreditCard className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                        {paymentMethods.map((pm, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-0.5 rounded text-[11px] font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700"
                          >
                            {pm}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Right: Price & Trade Button */}
                    <div className="flex items-center justify-between md:justify-end gap-6 pt-3 md:pt-0 border-t md:border-t-0 border-neutral-100 dark:border-neutral-800">
                      <div className="text-left md:text-right">
                        <span className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider block">
                          Unit Price
                        </span>
                        <div className="flex items-center md:justify-end gap-1.5 font-mono text-base sm:text-lg font-bold text-neutral-900 dark:text-white">
                          <img
                            src={getFiatFlagUrl(fiat)}
                            alt={fiat}
                            className="w-4 h-3 object-cover rounded-xs border border-neutral-300 dark:border-neutral-700 shadow-xs"
                          />
                          <span>
                            {price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}{' '}
                            {fiat}
                          </span>
                        </div>
                      </div>

                      <Link
                        href={`/ad/${ad.id}`}
                        className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-semibold rounded-xl text-xs sm:text-sm transition-colors shadow-xs flex items-center gap-1.5"
                      >
                        <span>Buy {asset}</span>
                        <ArrowUpRight className="w-4 h-4" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-10 rounded-2xl border border-dashed border-neutral-200 dark:border-neutral-800 text-center space-y-2 bg-neutral-50/50 dark:bg-neutral-900/40">
              <Coins className="w-8 h-8 text-neutral-400 mx-auto opacity-70" />
              <p className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                No active Buy advertisements
              </p>
              <p className="text-xs text-neutral-500 max-w-sm mx-auto">
                @{cleanUsername} currently has no active offers to buy cryptocurrency from.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Sell Ads List (Visitor SELLS to advertiser) */}
      {activeTab === 'sell_ads' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-neutral-900 dark:text-white">
              Sell Offers to @{cleanUsername}
            </h3>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {sellAds.length} active offer{sellAds.length !== 1 ? 's' : ''} (Sell crypto to @{cleanUsername})
            </span>
          </div>

          {sellAds.length > 0 ? (
            <div className="grid grid-cols-1 gap-3.5">
              {sellAds.map((ad) => {
                const asset = (ad.asset_symbol || ad.crypto || ad.asset || 'USDT').toUpperCase();
                const fiat = (ad.fiat_symbol || ad.fiat || ad.fiat_currency || 'USD').toUpperCase();
                const minLimit = Number(ad.min_limit ?? ad.min_amount ?? 10);
                const maxLimit = Number(ad.max_limit ?? ad.max_amount ?? 5000);
                const price = Number(ad.price || ad.unit_price || 0);
                const paymentMethods = parsePaymentMethods(ad.payment_methods);

                return (
                  <div
                    key={ad.id}
                    id={`ad-sell-${ad.id}`}
                    className="p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 hover:border-neutral-300 dark:hover:border-neutral-700 transition-all flex flex-col md:flex-row md:items-center justify-between gap-5"
                  >
                    {/* Left: Asset & Order Details */}
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 border border-rose-300 dark:border-rose-800/60">
                          SELL {asset}
                        </span>
                        <span className="text-xs text-neutral-500 dark:text-neutral-400">
                          Order Limit:{' '}
                          <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                            {minLimit.toLocaleString()} - {maxLimit.toLocaleString()} {fiat}
                          </span>
                        </span>
                      </div>

                      {/* Payment Methods Pills */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <CreditCard className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                        {paymentMethods.map((pm, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-0.5 rounded text-[11px] font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700"
                          >
                            {pm}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Right: Price & Trade Button */}
                    <div className="flex items-center justify-between md:justify-end gap-6 pt-3 md:pt-0 border-t md:border-t-0 border-neutral-100 dark:border-neutral-800">
                      <div className="text-left md:text-right">
                        <span className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider block">
                          Unit Price
                        </span>
                        <div className="flex items-center md:justify-end gap-1.5 font-mono text-base sm:text-lg font-bold text-neutral-900 dark:text-white">
                          <img
                            src={getFiatFlagUrl(fiat)}
                            alt={fiat}
                            className="w-4 h-3 object-cover rounded-xs border border-neutral-300 dark:border-neutral-700 shadow-xs"
                          />
                          <span>
                            {price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}{' '}
                            {fiat}
                          </span>
                        </div>
                      </div>

                      <Link
                        href={`/ad/${ad.id}`}
                        className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-semibold rounded-xl text-xs sm:text-sm transition-colors shadow-xs flex items-center gap-1.5"
                      >
                        <span>Sell {asset}</span>
                        <ArrowUpRight className="w-4 h-4" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-10 rounded-2xl border border-dashed border-neutral-200 dark:border-neutral-800 text-center space-y-2 bg-neutral-50/50 dark:bg-neutral-900/40">
              <Coins className="w-8 h-8 text-neutral-400 mx-auto opacity-70" />
              <p className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                No active Sell advertisements
              </p>
              <p className="text-xs text-neutral-500 max-w-sm mx-auto">
                @{cleanUsername} currently has no active offers to sell cryptocurrency to.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Tab 3 & 4: Feedback Received / Given */}
      {(activeTab === 'received' || activeTab === 'given') && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-neutral-900 dark:text-white">
              {activeTab === 'received'
                ? `Feedback Received (${receivedFeedbacks.length})`
                : `Feedback Given by @${cleanUsername} (${givenFeedbacks.length})`}
            </h3>

            {/* Filter Pills */}
            <div className="flex items-center gap-1 bg-neutral-100 dark:bg-neutral-800 p-1 rounded-lg text-xs font-semibold">
              <button
                onClick={() => setFeedbackFilter('all')}
                className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                  feedbackFilter === 'all'
                    ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white shadow-xs'
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFeedbackFilter('positive')}
                className={`px-3 py-1 rounded-md transition-colors flex items-center gap-1 cursor-pointer ${
                  feedbackFilter === 'positive'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
                }`}
              >
                <ThumbsUp className="w-3 h-3" />
                Positive
              </button>
              <button
                onClick={() => setFeedbackFilter('negative')}
                className={`px-3 py-1 rounded-md transition-colors flex items-center gap-1 cursor-pointer ${
                  feedbackFilter === 'negative'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40'
                }`}
              >
                <ThumbsDown className="w-3 h-3" />
                Negative
              </button>
            </div>
          </div>

          {displayedFeedbacks.length > 0 ? (
            <div className="grid grid-cols-1 gap-3">
              {displayedFeedbacks.map((fb) => {
                const isReceived = activeTab === 'received';
                const counterParty = isReceived ? fb.from_profile : fb.to_profile;
                const counterPartyName = (counterParty?.username || 'Trader').replace(/^@/, '');

                return (
                  <div
                    key={fb.id}
                    id={`feedback-item-${fb.id}`}
                    className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-2.5 shadow-xs"
                  >
                    <div className="flex items-center justify-between">
                      <Link
                        href={`/users/${counterPartyName}`}
                        className="flex items-center gap-2.5 group hover:opacity-80 transition-opacity"
                      >
                        <UserAvatar
                          userId={counterParty?.id || (fb as any)?.from_user_id || (fb as any)?.to_user_id || (fb as any)?.reviewer_id || (fb as any)?.reviewee_id}
                          avatarUrl={counterParty?.avatar_url || (counterParty as any)?.photo_url}
                          username={counterPartyName}
                          size="sm"
                        />
                        <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                          {isReceived ? `@${counterPartyName}` : `To @${counterPartyName}`}
                        </span>
                      </Link>

                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                          fb.is_positive
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800/60'
                            : 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 border border-rose-300 dark:border-rose-800/60'
                        }`}
                      >
                        {fb.is_positive ? (
                          <>
                            <ThumbsUp className="w-3 h-3" />
                            Positive
                          </>
                        ) : (
                          <>
                            <ThumbsDown className="w-3 h-3" />
                            Negative
                          </>
                        )}
                      </span>
                    </div>

                    <p className="text-xs sm:text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed pl-1">
                      {fb.comment || 'No written comment provided.'}
                    </p>

                    <div className="flex items-center justify-between text-[11px] text-neutral-400 pl-1 pt-1 border-t border-neutral-100 dark:border-neutral-800/80">
                      <span>{new Date(fb.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                      <span className="flex items-center gap-1 text-[10px] text-neutral-400">
                        <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                        Verified Trade Feedback
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-10 rounded-2xl border border-dashed border-neutral-200 dark:border-neutral-800 text-center space-y-2 bg-neutral-50/50 dark:bg-neutral-900/40">
              <MessageSquare className="w-8 h-8 text-neutral-400 mx-auto opacity-70" />
              <p className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                No feedback records found
              </p>
              <p className="text-xs text-neutral-500 max-w-sm mx-auto">
                {feedbackFilter !== 'all'
                  ? `There are no ${feedbackFilter} feedbacks to display.`
                  : activeTab === 'received'
                  ? 'This user has not received any trade feedback yet.'
                  : 'This user has not left any feedback for other traders yet.'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
