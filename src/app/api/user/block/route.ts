import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
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

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { targetUserId, action, activeTradeId } = await request.json();

  if (!targetUserId) {
    return NextResponse.json({ error: 'Target user ID is required' }, { status: 400 });
  }

  if (action === 'BLOCK') {
    const { error } = await supabase
      .from('user_blocks')
      .insert({ blocker_id: user.id, blocked_id: targetUserId });

    if (error && error.code !== '23505') {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Post System Message in Active Trade Chat if currently running
    if (activeTradeId) {
      const { data: blockerProfile } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', user.id)
        .single();

      const systemMessage = `⚠️ System Message: @${blockerProfile?.username || 'This user'} has blocked you. \nThe active trade remains ongoing and is NOT cancelled. You can continue sending necessary trade messages until completion or dispute resolution.`;

      await supabase.from('trade_chat_messages').insert({
        trade_id: activeTradeId,
        sender_id: user.id,
        message: systemMessage,
        is_system_message: true,
      });
    }

    return NextResponse.json({ success: true, message: 'User blocked.' });
  } else if (action === 'UNBLOCK') {
    const { error } = await supabase
      .from('user_blocks')
      .delete()
      .eq('blocker_id', user.id)
      .eq('blocked_id', targetUserId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: 'User unblocked.' });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
