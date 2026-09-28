import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized) {
      return auth.response!;
    }

    const adminId = auth.adminId || auth.user.id;
    const adminEmail = auth.adminEmail || 'admin@paxones.com';
    const supabase = getSupabaseAdminClient();

    const { disputeId, tradeId, resolution, notes } = await req.json();

    if (!disputeId || !tradeId || !['RELEASE', 'CANCEL'].includes(resolution)) {
      return NextResponse.json({ error: 'Invalid resolution parameters' }, { status: 400 });
    }

    let rpcResult;
    if (resolution === 'RELEASE') {
      rpcResult = await supabase.rpc('release_trade_escrow', {
        p_trade_id: tradeId,
        p_caller_id: adminId,
      });
    } else {
      rpcResult = await supabase.rpc('cancel_p2p_trade', {
        p_trade_id: tradeId,
        p_caller_id: adminId,
      });
    }

    if (rpcResult.error || (rpcResult.data && !rpcResult.data.success)) {
      const errMsg = rpcResult.error?.message || rpcResult.data?.message || 'Escrow settlement RPC failed';
      return NextResponse.json({ error: errMsg }, { status: 400 });
    }

    // Update dispute record
    await supabase
      .from('disputes')
      .update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
      })
      .eq('id', disputeId);

    // Audit log
    await supabase.from('admin_audit_logs').insert({
      admin_id: adminId,
      admin_email: adminEmail,
      action: 'RESOLVE_DISPUTE',
      target_id: tradeId,
      details: { disputeId, tradeId, resolution, notes },
    });

    return NextResponse.json({ success: true, data: rpcResult.data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

