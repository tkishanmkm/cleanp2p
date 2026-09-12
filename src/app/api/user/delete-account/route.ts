import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized: You must be logged in to delete an account.' }, { status: 401 });
    }

    const userId = user.id;

    // 1. Check if user has active ongoing trades before allowing deletion (for security)
    const { data: activeTrades } = await supabaseAdmin
      .from('trades')
      .select('id, status')
      .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
      .in('status', ['ACTIVE', 'PAID', 'DISPUTED', 'PENDING', 'ESCROW_LOCKED']);

    if (activeTrades && activeTrades.length > 0) {
      return NextResponse.json({
        error: 'Cannot delete account while you have active open trades or active escrow disputes. Please finalize or cancel open trades first.'
      }, { status: 400 });
    }

    // 2. Remove user ads
    try {
      await supabaseAdmin.from('p2p_ads').delete().eq('user_id', userId);
      await supabaseAdmin.from('ads').delete().eq('user_id', userId);
    } catch (e) {
      console.warn('Ad cleanup warning during account deletion:', e);
    }

    // 3. Remove user blocks
    try {
      await supabaseAdmin.from('user_blocks').delete().or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);
    } catch (e) {
      console.warn('User blocks cleanup warning:', e);
    }

    // 4. Mark or clean up profile
    try {
      await supabaseAdmin.from('profiles').update({
        status: 'deleted',
        is_suspended: true,
        full_name: '[Deleted User]',
        username: `deleted_${userId.slice(0, 8)}`,
        display_name: 'Deleted User',
        email: `deleted_${userId.slice(0, 8)}@paxones.local`,
        updated_at: new Date().toISOString(),
      }).eq('id', userId);
    } catch (e) {
      console.warn('Profile soft-delete update warning:', e);
    }

    // 5. Delete Supabase Auth User record
    try {
      await supabaseAdmin.auth.admin.deleteUser(userId);
    } catch (authDeleteErr: any) {
      console.warn('Auth user deletion warning:', authDeleteErr?.message || authDeleteErr);
    }

    // 6. Sign out cookies
    await supabase.auth.signOut();

    return NextResponse.json({
      success: true,
      message: 'Your account and data have been permanently deleted.'
    });
  } catch (err: any) {
    console.error('Account deletion fatal error:', err);
    return NextResponse.json({ error: err.message || 'Failed to delete account.' }, { status: 500 });
  }
}
