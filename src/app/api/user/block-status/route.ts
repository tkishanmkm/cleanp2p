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

  const { data: { user } } = await supabase.auth.getUser();
  const targetId = request.nextUrl.searchParams.get('targetId');

  if (!user || !targetId) {
    return NextResponse.json({ status: 'NOT_BLOCKED' });
  }

  // First attempt to call the RPC
  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc('get_block_relationship', {
      user_a: user.id,
      user_b: targetId,
    });

    if (!rpcError && rpcData) {
      return NextResponse.json({ status: rpcData });
    }
  } catch {
    // Fall back to direct query on user_blocks table
  }

  // Fallback: Direct table query
  try {
    const { data: blocks } = await supabase
      .from('user_blocks')
      .select('blocker_id, blocked_id')
      .or(`and(blocker_id.eq.${user.id},blocked_id.eq.${targetId}),and(blocker_id.eq.${targetId},blocked_id.eq.${user.id})`);

    const youBlockedThem = blocks?.some(b => b.blocker_id === user.id && b.blocked_id === targetId);
    const theyBlockedYou = blocks?.some(b => b.blocker_id === targetId && b.blocked_id === user.id);

    if (youBlockedThem && theyBlockedYou) {
      return NextResponse.json({ status: 'BLOCKED_BOTH_WAYS' });
    }
    if (youBlockedThem) {
      return NextResponse.json({ status: 'YOU_BLOCKED_THIS_USER' });
    }
    if (theyBlockedYou) {
      return NextResponse.json({ status: 'THIS_USER_BLOCKED_YOU' });
    }

    return NextResponse.json({ status: 'NOT_BLOCKED' });
  } catch (err: any) {
    return NextResponse.json({ status: 'NOT_BLOCKED', error: err?.message });
  }
}
