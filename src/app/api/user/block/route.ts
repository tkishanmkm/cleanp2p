import { createClient, createBearerClient, getSupabaseAdminClient } from '@/utils/supabase/server';
import { NextResponse, type NextRequest } from 'next/server';
import { insertPaxonesSystemMessage } from '@/lib/trade-system-messages';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Resolve identity only from the signed cookie or a validated bearer token.
    const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
    const supabase = bearerToken ? createBearerClient(bearerToken) : await createClient();

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

    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > 4096) {
      return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { targetUserId, action, activeTradeId } = body;

    if (typeof targetUserId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetUserId)) {
      return NextResponse.json({ error: 'A valid target user ID is required' }, { status: 400 });
    }
    if (targetUserId === user.id) {
      return NextResponse.json({ error: 'You cannot block or unblock yourself.' }, { status: 400 });
    }
    if (action !== 'BLOCK' && action !== 'UNBLOCK') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();

    if (action === 'BLOCK') {
      const { data: targetProfile, error: targetError } = await admin
        .from('profiles')
        .select('id, is_admin_account')
        .eq('id', targetUserId)
        .maybeSingle();
      if (targetError) return NextResponse.json({ error: 'Unable to validate target user' }, { status: 500 });
      if (!targetProfile) return NextResponse.json({ error: 'Target user not found' }, { status: 404 });
      if (targetProfile.is_admin_account) return NextResponse.json({ error: 'Admin accounts cannot be blocked here' }, { status: 403 });
    }

    // Get and validate the current user's account state before any block mutation.
    const { data: blockerProfile, error: blockerProfileError } = await admin
      .from('profiles')
      .select('id, username, blocked_users, is_banned, is_restricted, is_suspended, is_on_hold, is_emergency_frozen, is_minor_restricted, status, account_status')
      .eq('id', user.id)
      .maybeSingle();

    if (blockerProfileError || !blockerProfile) {
      return NextResponse.json({ error: 'Account status could not be verified.' }, { status: 503 });
    }
    const blockerStatus = String(blockerProfile.status || '').toLowerCase();
    const blockerAccountStatus = String(blockerProfile.account_status || '').toUpperCase();
    if (action === 'BLOCK' && (
      blockerProfile.is_banned === true ||
      blockerProfile.is_restricted === true ||
      blockerProfile.is_suspended === true ||
      blockerProfile.is_on_hold === true ||
      blockerProfile.is_emergency_frozen === true ||
      blockerProfile.is_minor_restricted === true ||
      ['banned', 'restricted', 'suspended', 'deleted', 'inactive', 'on_hold', 'hold'].includes(blockerStatus) ||
      ['BANNED', 'RESTRICTED', 'SUSPENDED', 'ON_HOLD', 'HOLD', 'BLOCKED', 'DELETION_PENDING', 'DELETED', 'INACTIVE'].includes(blockerAccountStatus)
    )) {
      return NextResponse.json({ error: 'Restricted accounts cannot block other users.' }, { status: 403 });
    }

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
          // A user may only emit a block notice in a trade they participate in,
          // and only when the blocked account is the other participant.
          if (typeof activeTradeId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(activeTradeId)) {
            return NextResponse.json({ success: true, message: 'User blocked.' });
          }
          const { data: trade } = await admin
            .from('trades')
            .select('id, buyer_id, seller_id')
            .eq('id', activeTradeId)
            .maybeSingle();
          const isBlockerBuyer = trade?.buyer_id === user.id;
          const isBlockerSeller = trade?.seller_id === user.id;
          const isCounterparty = (isBlockerBuyer && trade?.seller_id === targetUserId) ||
            (isBlockerSeller && trade?.buyer_id === targetUserId);
          if (!trade || (!isBlockerBuyer && !isBlockerSeller) || !isCounterparty) {
            return NextResponse.json({ success: true, message: 'User blocked.' });
          }

          const blockerName = blockerProfile?.username || 'Trader';
          let blockedName = 'Counterpart';
          const { data: targetProfile } = await admin
            .from('profiles')
            .select('username')
            .eq('id', targetUserId)
            .maybeSingle();
          if (targetProfile?.username) blockedName = targetProfile.username;

          await insertPaxonesSystemMessage(admin, {
            tradeId: trade.id,
            type: 'USER_BLOCKED',
            openerUsername: blockerName,
            blockedUsername: blockedName,
            initiatorRole: isBlockerBuyer ? 'Buyer' : 'Seller',
            targetRole: isBlockerBuyer ? 'Seller' : 'Buyer',
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
