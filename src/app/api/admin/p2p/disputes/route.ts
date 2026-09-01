import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const supabaseAdmin = getSupabaseAdminClient();

    let user: any = null;

    // Check Bearer authorization header
    const authHeader = request.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      const { data } = await supabaseAdmin.auth.getUser(token);
      if (data?.user) {
        user = data.user;
      }
    }

    if (!user) {
      const { data: { user: cookieUser } } = await supabase.auth.getUser();
      if (cookieUser) {
        user = cookieUser;
      }
    }

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Verify Admin Status (check profile role or email)
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role, is_admin, email')
      .eq('id', user.id)
      .maybeSingle();

    const isAdmin = profile?.role === 'admin' || profile?.is_admin === true || user.email === 'thekishanmishrakm@gmail.com';

    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { orderId, decision } = await request.json(); // decision: 'RELEASE_TO_BUYER' | 'REFUND_TO_SELLER'

    const { data: order, error: orderErr } = await supabaseAdmin
      .from('p2p_orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (orderErr || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const asset = order.crypto_asset || 'USDT';
    const net = order.network || 'ethereum';

    if (decision === 'RELEASE_TO_BUYER') {
      // Release escrow funds directly to buyer wallet
      await supabaseAdmin.rpc('release_escrow_funds', {
        buyer_user_id: order.buyer_id,
        asset: asset,
        net: net,
        release_amount: order.crypto_amount,
      });
    } else if (decision === 'REFUND_TO_SELLER') {
      // Refund escrow funds back to seller balance
      await supabaseAdmin.rpc('refund_disputed_escrow', {
        seller_user_id: order.seller_id,
        asset: asset,
        net: net,
        refund_amount: order.crypto_amount,
      });
    } else {
      return NextResponse.json({ error: 'Invalid decision payload' }, { status: 400 });
    }

    // Update Order Status to RESOLVED
    await supabaseAdmin
      .from('p2p_orders')
      .update({ status: `RESOLVED_${decision}`, updated_at: new Date().toISOString() })
      .eq('id', orderId);

    return NextResponse.json({ success: true, status: `RESOLVED_${decision}` });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Dispute resolution failed' }, { status: 500 });
  }
}
