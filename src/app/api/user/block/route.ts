import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdminClient } from '@/utils/supabase/server';
import { insertPaxonesSystemMessage } from '@/lib/trade-system-messages';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
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

    // Support Bearer token header if provided by frontend
    const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;

    let user = null;
    let authError: any = null;

    if (bearerToken) {
      const tokenAuth = await supabase.auth.getUser(bearerToken);
      user = tokenAuth.data?.user;
      authError = tokenAuth.error;
    }

    if (!user) {
      const cookieAuth = await supabase.auth.getUser();
      user = cookieAuth.data?.user;
      authError = cookieAuth.error;
    }

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { targetUserId, action, activeTradeId } = body;

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
        try {
          const blockerName = blockerProfile?.username || 'Trader';
          let blockedName = 'Counterpart';
          let blockerRole: 'Buyer' | 'Seller' = 'Buyer';
          let targetRole: 'Buyer' | 'Seller' = 'Seller';

          const { data: trade } = await admin
            .from('trades')
            .select('buyer_id, seller_id')
            .or(`id.eq.${activeTradeId},trade_id.eq.${activeTradeId}`)
            .maybeSingle();

          if (trade) {
            const isBlockerBuyer = trade.buyer_id === user.id;
            blockerRole = isBlockerBuyer ? 'Buyer' : 'Seller';
            targetRole = isBlockerBuyer ? 'Seller' : 'Buyer';
          }

          const { data: targetProfile } = await admin
            .from('profiles')
            .select('username')
            .eq('id', targetUserId)
            .maybeSingle();

          if (targetProfile?.username) blockedName = targetProfile.username;

          await insertPaxonesSystemMessage(admin, {
            tradeId: activeTradeId,
            type: 'USER_BLOCKED',
            openerUsername: blockerName,
            blockedUsername: blockedName,
            initiatorRole: blockerRole,
            targetRole: targetRole,
          });
        } catch (msgErr) {
          console.warn('System message error during block:', msgErr);
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
  } catch (error: any) {
    console.error('Error in /api/user/block:', error);
    return NextResponse.json({ error: error?.message || 'Failed to process block request' }, { status: 500 });
  }
}
