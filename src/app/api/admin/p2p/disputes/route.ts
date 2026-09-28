import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyServerAdmin(request);
    if (!auth.authorized) {
      return auth.response!;
    }

    const supabaseAdmin = getSupabaseAdminClient();
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
