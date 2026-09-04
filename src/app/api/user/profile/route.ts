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
    .ilike('username', username)
    .maybeSingle();

  if (error || !profile) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Calculate feedback and ratings if available
  const positive = profile.positive_feedback || 0;
  const negative = profile.negative_feedback || 0;
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

  return NextResponse.json({
    profile: {
      ...profile,
      positive_feedback_pct: positivePct,
      rating: profile.rating || 5.0,
      completed_trades: profile.completed_trades || 0,
    },
    blockStatus,
  });
}
