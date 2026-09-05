import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function POST(req: NextRequest) {
  try {
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

    // Check admin authorization
    const { data: isAdmin, error: adminCheckError } = await supabase.rpc('check_is_admin', {
      p_user_id: user.id,
    });

    if (adminCheckError || !isAdmin) {
      return NextResponse.json({ error: 'Forbidden: Admin privilege required' }, { status: 403 });
    }

    const { disputeId, tradeId, resolution, notes } = await req.json();

    if (!disputeId || !tradeId || !['RELEASE', 'CANCEL'].includes(resolution)) {
      return NextResponse.json({ error: 'Invalid resolution parameters' }, { status: 400 });
    }

    let rpcResult;
    if (resolution === 'RELEASE') {
      rpcResult = await supabase.rpc('release_trade_escrow', {
        p_trade_id: tradeId,
        p_caller_id: user.id,
      });
    } else {
      rpcResult = await supabase.rpc('cancel_p2p_trade', {
        p_trade_id: tradeId,
        p_caller_id: user.id,
        p_reason: notes || 'Resolved by admin cancellation',
      });
    }

    if (rpcResult.error) {
      return NextResponse.json({ error: rpcResult.error.message }, { status: 400 });
    }

    // Update dispute record
    await supabase
      .from('disputes')
      .update({
        status: 'resolved',
        resolution_type: resolution,
        resolved_by_id: user.id,
        resolution_notes: notes || 'Resolved by admin',
        updated_at: new Date().toISOString(),
      })
      .eq('id', disputeId);

    // Audit log
    await supabase.from('admin_audit_logs').insert({
      admin_id: user.id,
      action: 'RESOLVE_DISPUTE',
      details: { disputeId, tradeId, resolution, notes },
    });

    return NextResponse.json({ success: true, data: rpcResult.data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
