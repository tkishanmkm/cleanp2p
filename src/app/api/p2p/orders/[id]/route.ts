import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params;
    const body = await req.json();
    const { status } = body;

    if (!status) {
      return NextResponse.json({ error: 'Status is required' }, { status: 400 });
    }

    const cookieStore = cookies();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';
    const supabaseAdmin = getSupabaseAdminClient();

    let userId: string | null = null;

    const authHeader = req.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      const { data } = await supabaseAdmin.auth.getUser(token);
      if (data?.user) userId = data.user.id;
    }

    if (!userId) {
      const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
        },
      });
      const { data: { user } } = await supabase.auth.getUser();
      if (user) userId = user.id;
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

    // Authorization checks based on status transitions
    if (status === 'PAID') {
      if (userId && order.buyer_id && order.buyer_id !== userId) {
        return NextResponse.json({ error: 'Only buyer can mark order as paid' }, { status: 403 });
      }
    } else if (status === 'COMPLETED') {
      if (userId && order.seller_id && order.seller_id !== userId) {
        return NextResponse.json({ error: 'Only seller can release escrow' }, { status: 403 });
      }

      // If completing, credit buyer's balance in Supabase
      if (order.buyer_id && order.crypto_amount) {
        await supabaseAdmin.rpc('credit_user_balance', {
          target_user_id: order.buyer_id,
          target_asset: order.crypto_asset || 'USDT',
          target_network: order.network || 'ethereum',
          credit_amount: order.crypto_amount,
        });
      }
    }

    // 2. Update order record
    const { data: updatedOrder, error: updateErr } = await supabaseAdmin
      .from('p2p_orders')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId)
      .select()
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      order: updatedOrder,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
