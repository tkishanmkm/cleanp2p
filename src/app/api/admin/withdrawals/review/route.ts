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
    const supabaseAdmin = getSupabaseAdminClient();

    const { withdrawalId, action, rejectionReason } = await req.json();

    if (!withdrawalId || !['APPROVE', 'REJECT'].includes(action)) {
      return NextResponse.json({ error: 'Invalid payload parameters' }, { status: 400 });
    }

    if (action === 'APPROVE') {
      // Transition from NEEDS_APPROVAL -> PENDING so worker picks it up
      const { error } = await supabaseAdmin
        .from('onchain_withdrawals')
        .update({
          status: 'PENDING',
          approved_by: adminId,
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', withdrawalId)
        .eq('status', 'NEEDS_APPROVAL');

      if (error) throw error;

      await supabaseAdmin
        .from('withdrawals')
        .update({
          status: 'approved',
          updated_at: new Date().toISOString(),
        })
        .eq('id', withdrawalId)
        .catch(() => null);

      return NextResponse.json({
        success: true,
        message: 'Withdrawal approved and dispatched to dispatch queue.',
      });
    } else {
      // Call refund procedure to unlock user balance
      const { error: rpcError } = await supabaseAdmin.rpc('process_failed_withdrawal', {
        p_withdrawal_id: withdrawalId,
        p_error_reason: rejectionReason || 'Rejected by administrator during security review.',
      });

      if (rpcError) throw rpcError;

      return NextResponse.json({
        success: true,
        message: 'Withdrawal rejected and funds refunded to user.',
      });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

