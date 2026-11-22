import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tradeId: string }> }
) {
  try {
    const { tradeId } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tradeId)) {
      return NextResponse.json({ error: 'Invalid trade ID.' }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }
    const reason = (body as { reason?: unknown } | null)?.reason;
    if (typeof reason !== 'string' || reason.trim().length === 0 || reason.trim().length > 4000) {
      return NextResponse.json({ error: 'A dispute reason between 1 and 4000 characters is required.' }, { status: 400 });
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

    // The live RPC signature is raise_trade_dispute(p_trade_id, p_user_id, p_reason).
    // With a cookie-bound client, the RPC must bind this ID to auth.uid().
    const { data, error } = await supabase.rpc('raise_trade_dispute', {
      p_trade_id: tradeId,
      p_user_id: user.id,
      p_reason: reason.trim(),
    });

    if (error) {
      console.error('[P2P dispute] RPC failed:', { code: error.code || 'UNKNOWN' });
      return NextResponse.json({ error: 'Failed to open trade dispute.' }, { status: 400 });
    }
    if (!data || data.success !== true) {
      return NextResponse.json({ error: data?.message || 'Failed to open trade dispute.' }, { status: 400 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error('[P2P dispute] Unexpected route error.');
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
