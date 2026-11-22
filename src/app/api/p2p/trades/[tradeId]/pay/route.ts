import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export async function POST(
  req: NextRequest,
  { params }: { params: { tradeId: string } | Promise<{ tradeId: string }> }
) {
  try {
    const { tradeId } = await Promise.resolve(params);
    if (!tradeId) {
      return NextResponse.json({ error: 'Trade ID is required.' }, { status: 400 });
    }

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return req.cookies.getAll();
          },
        },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminClient = getSupabaseAdminClient();

    // Enforce buyer ownership in the trusted server route before using the
    // service-role client. The database RPC is not exposed to authenticated
    // clients after the companion ACL migration.
    const { data: trade, error: tradeError } = await adminClient
      .from('trades')
      .select('id, buyer_id')
      .eq('id', tradeId)
      .maybeSingle();

    if (tradeError) {
      console.error('Unable to verify trade ownership:', tradeError.message);
      return NextResponse.json({ error: 'Unable to verify trade ownership.' }, { status: 500 });
    }
    if (!trade) {
      return NextResponse.json({ error: 'Trade not found.' }, { status: 404 });
    }
    if (trade.buyer_id !== user.id) {
      return NextResponse.json({ error: 'Only the buyer can mark this trade as paid.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const paymentMethod = typeof (body.paymentMethod || body.payment_method) === 'string'
      ? (body.paymentMethod || body.payment_method).trim()
      : null;

    const { data, error } = await adminClient.rpc('mark_p2p_trade_paid', {
      p_trade_id: tradeId,
      p_caller_id: user.id,
      p_payment_method: paymentMethod,
    });

    if (error || (data && !data.success)) {
      const message = error?.message || data?.message || 'Failed to mark trade as paid.';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
