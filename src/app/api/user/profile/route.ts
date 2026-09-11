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

  try {
    const { data: completedTrades } = await supabase
      .from('trades')
      .select('id, fiat_amount, fiat_amount_usd, crypto_amount, crypto, status')
      .or(`buyer_id.eq.${profile.id},seller_id.eq.${profile.id}`)
      .in('status', ['completed', 'released']);

    if (completedTrades && completedTrades.length > 0) {
      completedTradeCount = completedTrades.length;
      totalTradeVolumeFiat = completedTrades.reduce((acc, t) => {
        const val = Number(t.fiat_amount || t.fiat_amount_usd || 0);
        return acc + (isNaN(val) ? 0 : val);
      }, 0);
    }
  } catch (err) {
    console.warn('Could not aggregate trade volume:', err);
  }

  // Calculate feedback and ratings
  let positive = Number(profile.positive_feedback || 0);
  let negative = Number(profile.negative_feedback || 0);

  try {
    const { data: fbList } = await supabase
      .from('trade_feedback')
      .select('rating, feedback_type')
      .eq('reviewee_id', profile.id);

    if (fbList && fbList.length > 0) {
      positive = fbList.filter(f => f.feedback_type === 'POSITIVE' || (f.rating && f.rating >= 4)).length;
      negative = fbList.filter(f => f.feedback_type === 'NEGATIVE' || (f.rating && f.rating < 4)).length;
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
    },
    blockStatus,
  });
}
