import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdminClient } from '@/utils/supabase/server';

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

  const admin = getSupabaseAdminClient();

  // Get current user profile
  const { data: blockerProfile } = await admin
    .from('profiles')
    .select('id, username, blocked_users')
    .eq('id', user.id)
    .maybeSingle();

  const currentBlocked: string[] = Array.isArray(blockerProfile?.blocked_users)
    ? blockerProfile.blocked_users
    : [];

  if (action === 'BLOCK') {
    // 1. Sync user_blocks table
    try {
      const { data: existingBlock } = await admin
        .from('user_blocks')
        .select('id')
        .eq('blocker_id', user.id)
        .eq('blocked_id', targetUserId)
        .maybeSingle();

      if (!existingBlock) {
        await admin
          .from('user_blocks')
          .insert({ blocker_id: user.id, blocked_id: targetUserId });
      }
    } catch (e) {
      console.warn('user_blocks table insert notice:', e);
    }

    // 2. Sync profiles.blocked_users array (ensure unique)
    const updatedBlocked = Array.from(new Set([...currentBlocked, targetUserId]));
    await admin
      .from('profiles')
      .update({ blocked_users: updatedBlocked, updated_at: new Date().toISOString() })
      .eq('id', user.id);

    // 3. Post System Message in Active Trade Chat if currently running
    if (activeTradeId) {
      const blockerName = blockerProfile?.username || 'Trader';
      let blockedName = 'Counterpart';
      try {
        const { data: targetProfile } = await admin
          .from('profiles')
          .select('username')
          .eq('id', targetUserId)
          .maybeSingle();
        if (targetProfile?.username) blockedName = targetProfile.username;
      } catch {}

      const systemMessage = `@${blockerName} blocked @${blockedName}.\nImportant: This trade is still active. If you have already made a payment, do not cancel the trade. Keep your payment evidence and follow the trade/dispute instructions.`;

      try {
        await admin.from('trade_messages').insert({
          trade_id: activeTradeId,
          sender_id: 'system',
          sender_username: 'Paxones System',
          message: systemMessage,
          is_system: true,
          is_moderator: true,
          created_at: new Date().toISOString(),
        });
      } catch (err) {
        console.warn('Notice inserting into trade_messages:', err);
      }

      try {
        await admin.from('trade_chat_messages').insert({
          trade_id: activeTradeId,
          sender_id: '00000000-0000-0000-0000-000000000000',
          message: systemMessage,
          is_system_message: true,
          created_at: new Date().toISOString(),
        });
      } catch (err) {
        // optional table
      }
    }

    return NextResponse.json({ success: true, message: 'User blocked.' });
  } else if (action === 'UNBLOCK') {
    // 1. Sync user_blocks table
    try {
      await admin
        .from('user_blocks')
        .delete()
        .eq('blocker_id', user.id)
        .eq('blocked_id', targetUserId);
    } catch (e) {
      console.warn('user_blocks table delete notice:', e);
    }

    // 2. Sync profiles.blocked_users array
    const updatedBlocked = currentBlocked.filter((id) => id !== targetUserId);
    await admin
      .from('profiles')
      .update({ blocked_users: updatedBlocked, updated_at: new Date().toISOString() })
      .eq('id', user.id);

    return NextResponse.json({ success: true, message: 'User unblocked.' });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
