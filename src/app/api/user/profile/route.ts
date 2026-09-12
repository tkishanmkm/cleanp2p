import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const cookieHeader = cookies();
  const cookieStore = typeof (cookieHeader as any)?.then === 'function' ? await cookieHeader : cookieHeader;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch {}
        },
      },
    }
  );

  const username = request.nextUrl.searchParams.get('username');
  if (!username) {
    return NextResponse.json({ error: 'Username parameter is required' }, { status: 400 });
  }

  // Fetch target profile
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .ilike('username', username.replace(/^@/, ''))
    .maybeSingle();

  if (error || !profile) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Calculate dynamic trades & fiat trade volume
  let completedTradeCount = profile.completed_trades || 0;
  let totalTradeVolumeFiat = profile.total_trade_volume_usd || profile.trade_volume || 0;

  // Real Dynamic Pay & Release Metrics
  let avgPayTimeSeconds: number | null = profile.avg_pay_time_seconds ?? null;
  let avgReleaseTimeSeconds: number | null = profile.avg_release_time_seconds ?? null;

  try {
    const { data: allUserTrades } = await supabase
      .from('trades')
      .select('id, buyer_id, seller_id, created_at, paid_at, marked_paid_at, released_at, completed_at, fiat_amount, fiat_amount_usd, status')
      .or(`buyer_id.eq.${profile.id},seller_id.eq.${profile.id}`);

    if (allUserTrades && allUserTrades.length > 0) {
      const completedList = allUserTrades.filter(t => t.status === 'completed' || t.status === 'released');
      completedTradeCount = completedList.length;
      totalTradeVolumeFiat = completedList.reduce((acc, t) => {
        const val = Number(t.fiat_amount || t.fiat_amount_usd || 0);
        return acc + (isNaN(val) ? 0 : val);
      }, 0);

      // Average Pay Time (for buyer trades): AVG(marked_paid_at - created_at)
      let buyerSum = 0;
      let buyerCount = 0;
      for (const t of allUserTrades) {
        if (t.buyer_id === profile.id && ['paid', 'completed', 'released', 'payment_sent'].includes(t.status)) {
          const paidStr = t.marked_paid_at || t.paid_at;
          const createdStr = t.created_at;
          if (paidStr && createdStr) {
            const diff = (new Date(paidStr).getTime() - new Date(createdStr).getTime()) / 1000;
            if (diff >= 2 && diff <= 86400) {
              buyerSum += diff;
              buyerCount++;
            }
          }
        }
      }
      if (buyerCount > 0) {
        avgPayTimeSeconds = Math.round(buyerSum / buyerCount);
      }

      // Average Release Time (for seller trades): AVG(released_at - marked_paid_at)
      let sellerSum = 0;
      let sellerCount = 0;
      for (const t of allUserTrades) {
        if (t.seller_id === profile.id && (t.status === 'completed' || t.status === 'released')) {
          const paidStr = t.marked_paid_at || t.paid_at;
          const releaseStr = t.released_at || t.completed_at;
          if (paidStr && releaseStr) {
            const diff = (new Date(releaseStr).getTime() - new Date(paidStr).getTime()) / 1000;
            if (diff >= 2 && diff <= 172800) {
              sellerSum += diff;
              sellerCount++;
            }
          }
        }
      }
      if (sellerCount > 0) {
        avgReleaseTimeSeconds = Math.round(sellerSum / sellerCount);
      }
    }
  } catch (err) {
    console.warn('Could not aggregate trade metrics:', err);
  }

  // Calculate block counts: "Has blocked X users" & "Has blocked by X users"
  let blockingCount = Array.isArray(profile.blocked_users) ? profile.blocked_users.length : 0;
  let blockedByCount = 0;

  try {
    // 1. Check user_blocks table
    const { count: ubBlocking } = await supabase
      .from('user_blocks')
      .select('id', { count: 'exact', head: true })
      .eq('blocker_id', profile.id);

    const { count: ubBlockedBy } = await supabase
      .from('user_blocks')
      .select('id', { count: 'exact', head: true })
      .eq('blocked_id', profile.id);

    if (typeof ubBlocking === 'number' && ubBlocking > blockingCount) {
      blockingCount = ubBlocking;
    }
    if (typeof ubBlockedBy === 'number') {
      blockedByCount = ubBlockedBy;
    }
  } catch (err) {
    console.warn('Block count query notice:', err);
  }

  // Format times nicely
  const formatTime = (secs: number | null | undefined) => {
    if (secs == null || isNaN(secs) || secs <= 0) return 'N/A';
    if (secs < 60) return `${Math.round(secs)}s`;
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins} min${mins > 1 ? 's' : ''}`;
    const hrs = (secs / 3600).toFixed(1);
    return `${hrs} hr${Number(hrs) > 1 ? 's' : ''}`;
  };

  const avgPayFormatted = formatTime(avgPayTimeSeconds);
  const avgReleaseFormatted = formatTime(avgReleaseTimeSeconds);

  // Calculate feedback and ratings
  let positive = Number(profile.positive_feedback || 0);
  let negative = Number(profile.negative_feedback || 0);

  try {
    const { data: fbList } = await supabase
      .from('trade_feedback')
      .select('rating, feedback_type, is_positive')
      .eq('reviewee_id', profile.id);

    if (fbList && fbList.length > 0) {
      positive = fbList.filter(f => f.is_positive === true || f.is_positive === 'true' || f.feedback_type === 'POSITIVE' || f.rating === 'positive' || (typeof f.rating === 'number' && f.rating >= 4)).length;
      negative = fbList.filter(f => f.is_positive === false || f.is_positive === 'false' || f.feedback_type === 'NEGATIVE' || f.rating === 'negative' || (typeof f.rating === 'number' && f.rating < 4)).length;
    }
  } catch (err) {
    console.warn('Feedback query warning:', err);
  }

  const totalFeedback = positive + negative;
  const positivePct = totalFeedback > 0 ? Math.round((positive / totalFeedback) * 100) : 100;

  // Check current viewer authentication for block status
  let blockStatus = 'NOT_BLOCKED';
  const { data: { user } } = await supabase.auth.getUser();

  if (user && user.id !== profile.id) {
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_block_relationship', {
        user_a: user.id,
        user_b: profile.id,
      });
      if (!rpcError && rpcData) {
        blockStatus = rpcData;
      } else {
        const { data: blocks } = await supabase
          .from('user_blocks')
          .select('blocker_id, blocked_id')
          .or(`and(blocker_id.eq.${user.id},blocked_id.eq.${profile.id}),and(blocker_id.eq.${profile.id},blocked_id.eq.${user.id})`);

        const youBlockedThem = blocks?.some(b => b.blocker_id === user.id && b.blocked_id === profile.id);
        const theyBlockedYou = blocks?.some(b => b.blocker_id === profile.id && b.blocked_id === user.id);

        if (youBlockedThem && theyBlockedYou) blockStatus = 'BLOCKED_BOTH_WAYS';
        else if (youBlockedThem) blockStatus = 'YOU_BLOCKED_THIS_USER';
        else if (theyBlockedYou) blockStatus = 'THIS_USER_BLOCKED_YOU';
      }
    } catch {
      // ignore check error
    }
  }

  const isIdVerified = Boolean(
    profile.is_id_verified || 
    profile.id_verified || 
    profile.kyc_status === 'VERIFIED' || 
    profile.verification_tier === 2 || 
    profile.verification_tier === 'TIER_2'
  );

  const isEmailVerified = Boolean(
    profile.is_email_verified || 
    profile.email_verified || 
    profile.email_confirmed_at ||
    true
  );

  return NextResponse.json({
    profile: {
      ...profile,
      is_email_verified: isEmailVerified,
      is_id_verified: isIdVerified,
      positive_feedback: positive,
      negative_feedback: negative,
      positive_feedback_pct: positivePct,
      rating: profile.rating || 5.0,
      completed_trades: completedTradeCount,
      total_volume: totalTradeVolumeFiat,
      trade_volume: totalTradeVolumeFiat,
      avg_pay_time_seconds: avgPayTimeSeconds,
      avg_release_time_seconds: avgReleaseTimeSeconds,
      avg_pay_time: avgPayFormatted,
      avg_release_time: avgReleaseFormatted,
      avg_payment_minutes: avgPayTimeSeconds ? Math.ceil(avgPayTimeSeconds / 60) : null,
      avg_release_minutes: avgReleaseTimeSeconds ? Math.ceil(avgReleaseTimeSeconds / 60) : null,
      blocking_count: blockingCount,
      blocked_by_count: blockedByCount,
      merchant_tier: profile?.merchant_tier || 'NONE',
      merchant_deposit_locked: profile.merchant_deposit_locked || 0,
      preferred_currency: profile.preferred_currency || profile.preferred_fiat || 'USD',
      preferred_fiat: profile.preferred_currency || profile.preferred_fiat || 'USD',
    },
    blockStatus,
  });
}
