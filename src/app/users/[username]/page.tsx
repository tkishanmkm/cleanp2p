import React from 'react';
import { notFound } from 'next/navigation';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import UserProfileClient from './UserProfileClient';

interface PageProps {
  params: Promise<{ username: string }> | { username: string };
}

export const dynamic = 'force-dynamic';

export default async function UserProfilePage({ params }: PageProps) {
  const rawParams = await Promise.resolve(params);
  const username = (rawParams?.username || '').replace(/^@/, '').trim();

  if (!username) return notFound();

  const supabase = getSupabaseAdminClient();
  const isUuid = /^[0-9a-fA-F-]{32,36}$/.test(username);

  // 1. Fetch Target Profile
  let profileQuery = supabase.from('profiles').select('*');
  if (isUuid) {
    profileQuery = profileQuery.or(`id.eq.${username},username.ilike.${username}`);
  } else {
    profileQuery = profileQuery.ilike('username', username);
  }

  const { data: profile, error: profileError } = await profileQuery.maybeSingle();

  if (profileError || !profile) {
    return notFound();
  }

  // 2. Fetch Active Ads listed by this user (both buy & sell)
  let userAds: any[] = [];
  try {
    const { data: adsData, error: adsError } = await supabase
      .from('ads')
      .select('*')
      .eq('user_id', profile.id)
      .neq('status', 'DELETED')
      .order('created_at', { ascending: false });

    if (!adsError && Array.isArray(adsData)) {
      userAds = adsData;
    } else {
      // Fallback to p2p_ads if table is structured under view
      const { data: p2pAdsData } = await supabase
        .from('p2p_ads')
        .select('*')
        .eq('user_id', profile.id)
        .neq('status', 'DELETED')
        .order('created_at', { ascending: false });
      if (Array.isArray(p2pAdsData)) {
        userAds = p2pAdsData;
      }
    }
  } catch (err) {
    console.warn('Error querying user ads:', err);
  }

  // Fetch user's crypto balances for precise limit clamping
  let userCryptoBalances: Record<string, number> = {
    BTC: Number(profile.btc_balance || 0),
    ETH: Number(profile.eth_balance || 0),
    LTC: Number(profile.ltc_balance || 0),
    USDT: Number(profile.usdt_balance || 0),
    SOL: Number(profile.sol_balance || 0),
  };

  try {
    const { data: userWallets } = await supabase
      .from('user_wallets')
      .select('*')
      .eq('user_id', profile.id);

    if (userWallets && userWallets.length > 0) {
      userWallets.forEach((w: any) => {
        const sym = (w.asset_symbol || w.symbol || w.crypto || '').toUpperCase();
        const bal = Number(w.available_balance ?? w.available ?? w.balance ?? 0);
        if (sym && bal > 0) {
          userCryptoBalances[sym] = Math.max(userCryptoBalances[sym] || 0, bal);
        }
      });
    }

    const { data: walletAssets } = await supabase
      .from('wallet_assets')
      .select('*')
      .eq('user_id', profile.id);

    if (walletAssets && walletAssets.length > 0) {
      walletAssets.forEach((a: any) => {
        const sym = (a.asset_symbol || a.asset_code || a.symbol || a.crypto || '').toUpperCase();
        const bal = Number(a.available ?? a.balance ?? a.amount ?? 0);
        if (sym && bal > 0) {
          userCryptoBalances[sym] = Math.max(userCryptoBalances[sym] || 0, bal);
        }
      });
    }
  } catch (err) {
    console.warn('Error querying wallet balances:', err);
  }

  // Filter ads from visitor perspective and attach available crypto:
  // 1. If advertiser created a 'SELL' ad, the visitor BUYs crypto from advertiser -> "Buy Ads" tab
  const buyAds = userAds
    .filter((ad) => {
      const type = String(ad.type || ad.ad_type || ad.trade_type || '').toUpperCase();
      const isActive = ad.is_active !== false && ad.active !== false && String(ad.status || '').toUpperCase() !== 'INACTIVE';
      return (type === 'SELL' || type === 'ONLINE_SELL' || type === '') && isActive;
    })
    .map((ad) => {
      const sym = (ad.asset_symbol || ad.crypto || ad.asset || 'USDT').toUpperCase();
      return {
        ...ad,
        available_crypto: userCryptoBalances[sym] ?? -1,
      };
    });

  // 2. If advertiser created a 'BUY' ad, the visitor SELLs crypto to advertiser -> "Sell Ads" tab
  const sellAds = userAds
    .filter((ad) => {
      const type = String(ad.type || ad.ad_type || ad.trade_type || '').toUpperCase();
      const isActive = ad.is_active !== false && ad.active !== false && String(ad.status || '').toUpperCase() !== 'INACTIVE';
      return (type === 'BUY' || type === 'ONLINE_BUY') && isActive;
    })
    .map((ad) => ({
      ...ad,
    }));

  // 3. Aggregate Real Trade Stats & Dynamic Averages from trades table
  let completedTradeCount = Number(profile.completed_trades || 0);
  let totalVolumeUSD = Number(profile.total_trade_volume_usd || profile.trade_volume || profile.total_volume || 0);
  let avgPayTimeSeconds = profile.avg_pay_time_seconds ?? null;
  let avgReleaseTimeSeconds = profile.avg_release_time_seconds ?? null;

  try {
    const { data: userTrades } = await supabase
      .from('trades')
      .select('id, buyer_id, seller_id, created_at, paid_at, marked_paid_at, released_at, completed_at, resolved_at, fiat_amount, fiat_amount_usd, amount_usd, price, amount, crypto_amount, status')
      .or(`buyer_id.eq.${profile.id},seller_id.eq.${profile.id}`);

    if (userTrades && userTrades.length > 0) {
      const completedList = userTrades.filter((t) => {
        const s = String(t.status || '').toLowerCase();
        return ['completed', 'released', 'resolved', 'paid', 'settled'].includes(s);
      });

      if (completedList.length > 0) {
        completedTradeCount = completedList.length;

        const calculatedVolume = completedList.reduce((acc, t) => {
          const val = Number(t.fiat_amount || t.fiat_amount_usd || t.amount_usd || 0);
          if (val > 0) return acc + val;
          const cryptoAmt = Number(t.amount || t.crypto_amount || 0);
          const unitPrice = Number(t.price || 0);
          if (cryptoAmt > 0 && unitPrice > 0) return acc + (cryptoAmt * unitPrice);
          return acc;
        }, 0);

        if (calculatedVolume > 0) {
          totalVolumeUSD = calculatedVolume;
        }

        // Avg Pay Time (for buyer trades): AVG(marked_paid_at - created_at)
        let buyerPaySum = 0;
        let buyerPayCount = 0;
        for (const t of userTrades) {
          if (t.buyer_id === profile.id) {
            const paidStr = t.marked_paid_at || t.paid_at;
            const createdStr = t.created_at;
            if (paidStr && createdStr) {
              const diffSec = (new Date(paidStr).getTime() - new Date(createdStr).getTime()) / 1000;
              if (diffSec >= 5 && diffSec <= 86400) {
                buyerPaySum += diffSec;
                buyerPayCount++;
              }
            }
          }
        }
        if (buyerPayCount > 0) {
          avgPayTimeSeconds = Math.round(buyerPaySum / buyerPayCount);
        }

        // Avg Release Time (for seller trades): AVG(released_at - marked_paid_at)
        let sellerRelSum = 0;
        let sellerRelCount = 0;
        for (const t of userTrades) {
          if (t.seller_id === profile.id) {
            const paidStr = t.marked_paid_at || t.paid_at;
            const relStr = t.released_at || t.completed_at || t.resolved_at;
            if (paidStr && relStr) {
              const diffSec = (new Date(relStr).getTime() - new Date(paidStr).getTime()) / 1000;
              if (diffSec >= 5 && diffSec <= 172800) {
                sellerRelSum += diffSec;
                sellerRelCount++;
              }
            }
          }
        }
        if (sellerRelCount > 0) {
          avgReleaseTimeSeconds = Math.round(sellerRelSum / sellerRelCount);
        }
      }
    }
  } catch (tradeErr) {
    console.warn('Trades stats query notice:', tradeErr);
  }

  // 4. Fetch Feedbacks (Trade feedback received and given)
  let receivedFeedbacks: any[] = [];
  let givenFeedbacks: any[] = [];

  try {
    // A. Received feedbacks
    const { data: recFb1 } = await supabase
      .from('feedbacks')
      .select('id, rating, is_positive, comment, created_at, from_user_id, from_profile:profiles!from_user_id(id, username, avatar_url)')
      .eq('to_user_id', profile.id)
      .order('created_at', { ascending: false });

    if (Array.isArray(recFb1) && recFb1.length > 0) {
      receivedFeedbacks = recFb1;
    } else {
      const { data: recFb2 } = await supabase
        .from('trade_feedback')
        .select('id, rating, is_positive, feedback_type, comment, created_at, reviewer_id, reviewer:profiles!reviewer_id(id, username, avatar_url)')
        .eq('reviewee_id', profile.id)
        .order('created_at', { ascending: false });

      if (Array.isArray(recFb2)) {
        receivedFeedbacks = recFb2.map((f: any) => ({
          id: f.id,
          rating: f.rating,
          is_positive: f.is_positive === true || f.is_positive === 'true' || f.feedback_type === 'POSITIVE' || f.rating === 'positive',
          comment: f.comment,
          created_at: f.created_at,
          from_profile: f.reviewer || null,
        }));
      }
    }

    // B. Given feedbacks
    const { data: givFb1 } = await supabase
      .from('feedbacks')
      .select('id, rating, is_positive, comment, created_at, to_user_id, to_profile:profiles!to_user_id(id, username, avatar_url)')
      .eq('from_user_id', profile.id)
      .order('created_at', { ascending: false });

    if (Array.isArray(givFb1) && givFb1.length > 0) {
      givenFeedbacks = givFb1;
    } else {
      const { data: givFb2 } = await supabase
        .from('trade_feedback')
        .select('id, rating, is_positive, feedback_type, comment, created_at, reviewee_id, reviewee:profiles!reviewee_id(id, username, avatar_url)')
        .eq('reviewer_id', profile.id)
        .order('created_at', { ascending: false });

      if (Array.isArray(givFb2)) {
        givenFeedbacks = givFb2.map((f: any) => ({
          id: f.id,
          rating: f.rating,
          is_positive: f.is_positive === true || f.is_positive === 'true' || f.feedback_type === 'POSITIVE' || f.rating === 'positive',
          comment: f.comment,
          created_at: f.created_at,
          to_profile: f.reviewee || null,
        }));
      }
    }
  } catch (fbErr) {
    console.warn('Feedback query warning:', fbErr);
  }

  // 5. Compute Positive/Negative Feedback Summary
  const positiveFeedbacksCount = receivedFeedbacks.filter((f) => f.is_positive === true || f.is_positive === 'true' || (f.rating || '').toUpperCase() === 'POSITIVE').length;
  const negativeFeedbacksCount = receivedFeedbacks.filter((f) => f.is_positive === false || f.is_positive === 'false' || (f.rating || '').toUpperCase() === 'NEGATIVE').length;
  const totalFeedbackCount = receivedFeedbacks.length;
  const positiveRatio = totalFeedbackCount > 0 ? ((positiveFeedbacksCount / totalFeedbackCount) * 100).toFixed(0) : '100';

  // 6. Verification Statuses
  const isEmailVerified = Boolean(
    profile.is_email_verified ||
    profile.email_verified ||
    profile.email_confirmed_at ||
    (profile.email && !profile.email.includes('placeholder'))
  );

  const kycStatusRaw = (profile.kyc_status || profile.identity_status || '').toUpperCase();
  const isIdVerified = Boolean(
    profile.is_id_verified ||
    profile.id_verified ||
    kycStatusRaw === 'VERIFIED' ||
    kycStatusRaw === 'APPROVED' ||
    profile.verification_tier === 2 ||
    profile.verification_tier === 'TIER_2'
  );

  const countryCode = (profile.country || profile.country_code || 'US').toUpperCase();

  return (
    <UserProfileClient
      profile={{
        ...profile,
        last_seen: profile.last_seen || profile.last_seen_at || profile.last_active || profile.updated_at || null,
        last_seen_at: profile.last_seen || profile.last_seen_at || profile.last_active || profile.updated_at || null,
        last_active: profile.last_seen || profile.last_seen_at || profile.last_active || profile.updated_at || null,
        is_online: profile.is_online ?? false,
        username: profile.username || username,
        is_email_verified: isEmailVerified,
        is_id_verified: isIdVerified,
        kyc_status: kycStatusRaw || (isIdVerified ? 'VERIFIED' : 'UNVERIFIED'),
        country: countryCode,
      }}
      buyAds={buyAds}
      sellAds={sellAds}
      receivedFeedbacks={receivedFeedbacks}
      givenFeedbacks={givenFeedbacks}
      stats={{
        completedTrades: completedTradeCount,
        tradeVolumeUSD: totalVolumeUSD,
        avgPayTimeSeconds: avgPayTimeSeconds,
        avgReleaseTimeSeconds: avgReleaseTimeSeconds,
        positiveFeedbacksCount,
        negativeFeedbacksCount,
        positiveRatio,
        totalFeedbackCount,
        blockedBy: Number(profile.blocked_by_count || 0),
        hasBlocked: Number(profile.blocking_count || 0),
      }}
    />
  );
}
