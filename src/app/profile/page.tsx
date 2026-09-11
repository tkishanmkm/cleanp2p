'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { 
  ShieldCheck, 
  User, 
  Clock, 
  Award, 
  Loader2, 
  Ban, 
  Unlock, 
  ThumbsUp, 
  ThumbsDown, 
  Star, 
  MailCheck, 
  Lock, 
  ExternalLink,
  MessageSquare,
  DollarSign,
  AlertCircle
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers/auth-provider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatCurrencyValue } from '@/utils/userPrivacy';

interface AccountData {
  id: string;
  full_name: string;
  username: string;
  email: string;
  preferred_fiat: string;
  total_volume: number;
  completed_trades: number;
  avg_payment_time: number;
  avg_release_time: number;
  dob?: string;
  created_at?: string;
  is_2fa_enabled?: boolean;
  kyc_status?: string;
  verification_tier?: number | string;
}

export default function ProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const [account, setAccount] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);
  const [blockedUsers, setBlockedUsers] = useState<any[]>([]);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const [feedbacks, setFeedbacks] = useState<any[]>([]);
  const [feedbackTab, setFeedbackTab] = useState<'received' | 'given'>('received');
  const [activeTab, setActiveTab] = useState<'overview' | 'blocked' | 'feedback'>('overview');

  const userId = user?.id || (user as any)?.uid;

  const loadProfileData = useCallback(async () => {
    if (!userId) {
      if (!authLoading) setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const supabase = createClient();

      // 1. Fetch user profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      // 2. Fetch live trades for accurate fiat volume and completed trades count
      let completedTradesCount = profile?.completed_trades || 0;
      let totalVolumeFiat = profile?.total_trade_volume_usd || profile?.trade_volume || 0;

      const { data: userTrades } = await supabase
        .from('trades')
        .select('id, fiat_amount, fiat_amount_usd, crypto_amount, status')
        .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
        .in('status', ['completed', 'released']);

      if (userTrades && userTrades.length > 0) {
        completedTradesCount = userTrades.length;
        totalVolumeFiat = userTrades.reduce((acc: number, t: any) => {
          const val = Number(t.fiat_amount || t.fiat_amount_usd || 0);
          return acc + (isNaN(val) ? 0 : val);
        }, 0);
      }

      setAccount({
        id: userId,
        full_name: profile?.full_name || (user as any)?.user_metadata?.full_name || profile?.username || 'Trader',
        username: profile?.username || (user as any)?.user_metadata?.username || 'user',
        email: user.email || profile?.email || '',
        preferred_fiat: profile?.preferred_fiat || profile?.preferred_currency || 'USD',
        total_volume: totalVolumeFiat,
        completed_trades: completedTradesCount,
        avg_payment_time: 4,
        avg_release_time: 2,
        dob: profile?.dob || 'Not provided',
        created_at: profile?.created_at || user?.created_at,
        is_2fa_enabled: Boolean(profile?.is_2fa_enabled || profile?.is_mfa_enabled),
        kyc_status: profile?.kyc_status || 'NOT_SUBMITTED',
        verification_tier: profile?.verification_tier || 1,
      });

      // 3. Fetch Blocked Users
      const { data: blocks } = await supabase
        .from('user_blocks')
        .select(`
          id,
          blocked_id,
          created_at,
          blocked:profiles!user_blocks_blocked_id_fkey(id, username, avatar_url)
        `)
        .eq('blocker_id', userId);

      if (blocks) {
        setBlockedUsers(blocks.map((b: any) => ({
          id: b.id,
          userId: b.blocked_id,
          username: b.blocked?.username || 'Unknown User',
          avatarUrl: b.blocked?.avatar_url,
          blockedAt: b.created_at,
        })));
      }

      // 4. Fetch Feedback (given and received)
      const { data: fb } = await supabase
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
        .or(`reviewee_id.eq.${userId},reviewer_id.eq.${userId}`)
        .order('created_at', { ascending: false });

      if (fb) {
        setFeedbacks(fb);
      }
    } catch (err) {
      console.error('Failed to load full private profile:', err);
    } finally {
      setLoading(false);
    }
  }, [userId, authLoading, user]);

  useEffect(() => {
    loadProfileData();
  }, [loadProfileData]);

  const handleUnblock = async (blockedUserId: string) => {
    setUnblockingId(blockedUserId);
    try {
      const res = await fetch('/api/user/block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: blockedUserId, action: 'UNBLOCK' }),
      });

      if (res.ok) {
        setBlockedUsers((prev) => prev.filter((u) => u.userId !== blockedUserId));
      }
    } catch (e) {
      console.error('Unblock failed:', e);
    } finally {
      setUnblockingId(null);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-[500px] flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
        <span className="text-xs text-slate-500 font-medium">Loading your profile & activity...</span>
      </div>
    );
  }

  if (!user || !account) {
    return (
      <div className="max-w-md mx-auto my-16 p-8 bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] rounded-3xl text-center space-y-4 shadow-xl">
        <div className="w-14 h-14 bg-amber-500/10 text-amber-500 rounded-full flex items-center justify-center mx-auto border border-amber-500/20">
          <AlertCircle className="w-7 h-7" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Sign In Required</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Please sign in to view your private profile, account details, feedback, and security settings.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center justify-center gap-2 w-full bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 font-semibold py-2.5 px-4 rounded-xl text-xs transition shadow-sm"
        >
          Go to Login
        </Link>
      </div>
    );
  }

  const receivedFeedbacks = feedbacks.filter((f) => f.reviewee_id === userId);
  const givenFeedbacks = feedbacks.filter((f) => f.reviewer_id === userId);
  const displayedFeedbacks = feedbackTab === 'received' ? receivedFeedbacks : givenFeedbacks;

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Account Owner Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-6 bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] rounded-3xl gap-4 shadow-xl">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Account Owner</h1>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
              Private Profile
            </span>
            <Link
              href={`/users/${account.username}`}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
            >
              <span>View Public Profile</span>
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Logged in as <span className="font-bold text-slate-900 dark:text-white">@{account.username}</span> ({account.email})
          </p>
        </div>

        <div className="flex items-center gap-2">
          {account.is_2fa_enabled && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-xl border border-emerald-500/20 font-semibold">
              <ShieldCheck className="h-3.5 w-3.5" />
              2FA Protected
            </span>
          )}
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-[#07090e] border border-slate-200 dark:border-[#1e2640] rounded-2xl">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`flex-1 py-2 px-4 rounded-xl text-xs font-semibold transition cursor-pointer text-center ${
            activeTab === 'overview'
              ? 'bg-white dark:bg-[#0f1423] text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          Details & Performance
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('blocked')}
          className={`flex-1 py-2 px-4 rounded-xl text-xs font-semibold transition cursor-pointer text-center flex items-center justify-center gap-1.5 ${
            activeTab === 'blocked'
              ? 'bg-white dark:bg-[#0f1423] text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <span>Blocked Users</span>
          {blockedUsers.length > 0 && (
            <span className="px-2 py-0.2 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400 text-[10px]">
              {blockedUsers.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('feedback')}
          className={`flex-1 py-2 px-4 rounded-xl text-xs font-semibold transition cursor-pointer text-center flex items-center justify-center gap-1.5 ${
            activeTab === 'feedback'
              ? 'bg-white dark:bg-[#0f1423] text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <span>Feedbacks</span>
          <span className="px-2 py-0.2 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px]">
            {feedbacks.length}
          </span>
        </button>
      </div>

      {/* Tab 1: Overview */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Private Information */}
          <Card className="rounded-3xl border-slate-200 dark:border-[#1e2640] bg-white dark:bg-[#0f1423]">
            <CardHeader className="pb-3 border-b border-slate-100 dark:border-[#1e2640]">
              <CardTitle className="text-sm font-bold flex items-center justify-between">
                <span className="flex items-center gap-2 text-slate-900 dark:text-white">
                  <User className="h-4 w-4 text-amber-500" /> Private Information
                </span>
                <Link href="/settings" className="text-xs text-amber-600 dark:text-amber-400 hover:underline">
                  Edit in Settings →
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-4 text-xs">
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-[#1e2640]">
                <span className="text-slate-500">Legal Name</span>
                <span className="font-semibold text-slate-900 dark:text-white">{account.full_name}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-[#1e2640]">
                <span className="text-slate-500">Username Handle</span>
                <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">@{account.username}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-[#1e2640]">
                <span className="text-slate-500">Email Address</span>
                <span className="font-semibold text-slate-900 dark:text-white">{account.email}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-[#1e2640]">
                <span className="text-slate-500">Date of Birth</span>
                <span className="font-medium text-slate-700 dark:text-slate-300">{account.dob}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-[#1e2640]">
                <span className="text-slate-500">Preferred Fiat</span>
                <span className="font-bold text-slate-900 dark:text-white">{account.preferred_fiat}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-slate-500">Two-Factor Authentication</span>
                <span className={`font-semibold ${account.is_2fa_enabled ? 'text-emerald-500' : 'text-slate-400'}`}>
                  {account.is_2fa_enabled ? 'Enabled (Authenticator App)' : 'Not Enabled'}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Trading Performance */}
          <Card className="rounded-3xl border-slate-200 dark:border-[#1e2640] bg-white dark:bg-[#0f1423]">
            <CardHeader className="pb-3 border-b border-slate-100 dark:border-[#1e2640]">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-slate-900 dark:text-white">
                <Award className="h-4 w-4 text-amber-500" /> Trading Performance
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-4 text-xs">
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-[#1e2640]">
                <span className="text-slate-500">Total Volume</span>
                <span className="font-bold text-slate-900 dark:text-white">
                  {formatCurrencyValue(account.total_volume, account.preferred_fiat)}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-[#1e2640]">
                <span className="text-slate-500">Completed Trades</span>
                <span className="font-bold text-slate-900 dark:text-white">{account.completed_trades}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-[#1e2640]">
                <span className="text-slate-500">Avg. Payment Time</span>
                <span className="font-medium text-slate-900 dark:text-white">{account.avg_payment_time} min</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-[#1e2640]">
                <span className="text-slate-500">Avg. Release Time</span>
                <span className="font-medium text-slate-900 dark:text-white">{account.avg_release_time} min</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-slate-500">Verification Tier</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {account.kyc_status === 'VERIFIED' ? 'Tier 2 (Verified - No Limits)' : 'Tier 1 ($1,000 USD Limit)'}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tab 2: Blocked Users */}
      {activeTab === 'blocked' && (
        <Card className="rounded-3xl border-slate-200 dark:border-[#1e2640] bg-white dark:bg-[#0f1423]">
          <CardHeader className="border-b border-slate-100 dark:border-[#1e2640]">
            <CardTitle className="text-sm font-bold flex items-center justify-between text-slate-900 dark:text-white">
              <span className="flex items-center gap-2">
                <Ban className="h-4 w-4 text-rose-500" /> Blocked Users List
              </span>
              <span className="text-xs text-slate-400 font-normal">
                {blockedUsers.length} blocked
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            {blockedUsers.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs">
                You haven't blocked any users.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-[#1e2640]">
                {blockedUsers.map((u) => (
                  <div key={u.id} className="py-3 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-bold text-xs">
                        {u.username.substring(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-900 dark:text-white">@{u.username}</p>
                        <p className="text-[10px] text-slate-400">Blocked on {new Date(u.blockedAt).toLocaleDateString()}</p>
                      </div>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleUnblock(u.userId)}
                      disabled={unblockingId === u.userId}
                      className="text-xs h-8 px-3 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      {unblockingId === u.userId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Unlock className="h-3.5 w-3.5 mr-1" /> Unblock</>}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tab 3: Feedback */}
      {activeTab === 'feedback' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs">
              <button
                type="button"
                onClick={() => setFeedbackTab('received')}
                className={`px-3 py-1 rounded-lg font-semibold transition cursor-pointer ${
                  feedbackTab === 'received' 
                    ? 'bg-white dark:bg-[#0f1423] text-slate-900 dark:text-white shadow-sm' 
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Feedback Received ({receivedFeedbacks.length})
              </button>
              <button
                type="button"
                onClick={() => setFeedbackTab('given')}
                className={`px-3 py-1 rounded-lg font-semibold transition cursor-pointer ${
                  feedbackTab === 'given' 
                    ? 'bg-white dark:bg-[#0f1423] text-slate-900 dark:text-white shadow-sm' 
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Feedback Given ({givenFeedbacks.length})
              </button>
            </div>
          </div>

          {displayedFeedbacks.length === 0 ? (
            <div className="p-12 text-center rounded-3xl bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] text-slate-400 text-xs">
              No feedback records found in this category.
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
                        <Link 
                          href={`/users/${counterparty?.username || 'trader'}`}
                          className="text-xs font-bold text-slate-900 dark:text-white hover:underline"
                        >
                          @{counterparty?.username || 'Trader'}
                        </Link>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {fb.created_at ? new Date(fb.created_at).toLocaleDateString() : ''}
                        </span>
                      </div>

                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                        {fb.comment || (isPositive ? 'Smooth transaction, fast escrow release.' : 'Disputed or delayed trade.')}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
