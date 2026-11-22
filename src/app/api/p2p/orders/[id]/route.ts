import { NextRequest, NextResponse } from 'next/server';
import { createClient, createBearerClient, getSupabaseAdminClient } from '@/utils/supabase/server';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const rawParams = await Promise.resolve(context.params);
    const orderId = rawParams.id;
    const body = await req.json();
    const { status } = body;

    if (typeof status !== 'string' || !['PAID', 'COMPLETED'].includes(status)) {
      return NextResponse.json({ error: 'Unsupported order status transition.' }, { status: 400 });
    }

    // Completion must go through the dedicated authenticated, atomic escrow-release endpoint.
    // Never credit a wallet directly from this generic order-status route.
    if (status === 'COMPLETED') {
      return NextResponse.json(
        { error: 'Use the dedicated trade escrow-release endpoint to complete a trade.' },
        { status: 409 }
      );
    }

    const supabaseAdmin = getSupabaseAdminClient();
    const authHeader = req.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ')
      ? authHeader.replace(/^Bearer\s+/i, '').trim()
      : null;
    const authClient = bearerToken ? createBearerClient(bearerToken) : await createClient();
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    const userId = authError ? null : user?.id ?? null;

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Fetch current order
    const { data: order, error: fetchErr } = await supabaseAdmin
      .from('p2p_orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (fetchErr || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // Only the authenticated buyer may mark their own order as paid.
    if (!order.buyer_id || order.buyer_id !== userId) {
      return NextResponse.json({ error: 'Only the order buyer can mark it as paid.' }, { status: 403 });
    }

    const currentStatus = String(order.status || '').toUpperCase();
    if (!['ACTIVE', 'PENDING', 'CREATED', 'ESCROW_LOCKED'].includes(currentStatus)) {
      return NextResponse.json({ error: 'This order cannot transition to PAID from its current state.' }, { status: 409 });
    }

    // Compare-and-set the observed status to prevent stale/replayed transitions.
    const { data: updatedOrder, error: updateErr } = await supabaseAdmin
      .from('p2p_orders')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId)
      .eq('status', order.status)
      .select()
      .maybeSingle();

    if (updateErr) {
      return NextResponse.json({ error: 'Unable to update order status.' }, { status: 500 });
    }
    if (!updatedOrder) {
      return NextResponse.json({ error: 'Order status changed; refresh and try again.' }, { status: 409 });
    }

    return NextResponse.json({
      success: true,
      order: updatedOrder,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
