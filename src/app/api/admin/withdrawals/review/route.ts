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
      // Call authoritative approve_withdrawal RPC (verifies admin status and transitions state atomically)
      const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('approve_withdrawal', {
        p_withdrawal_id: withdrawalId,
        p_admin_id: adminId,
      });

      if (rpcError) {
        return NextResponse.json({ error: rpcError.message || 'Failed to approve withdrawal' }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        data: rpcData,
        message: 'Withdrawal approved and queued for broadcast.',
      });
    } else {
      // Call authoritative refund procedure to safely return liability to available balance
      const { data: refundData, error: rpcError } = await supabaseAdmin.rpc('process_failed_withdrawal', {
        p_withdrawal_id: withdrawalId,
        p_error_reason: rejectionReason || 'Rejected by administrator during security review.',
      });

      if (rpcError) {
        return NextResponse.json({ error: rpcError.message || 'Failed to reject withdrawal' }, { status: 400 });
      }

      // Record Admin Rejection in Audit Log
      await supabaseAdmin.from('admin_audit_logs').insert({
        admin_id: adminId,
        admin_email: auth.adminEmail || 'admin@paxones.com',
        action: 'ADMIN_REJECTED_WITHDRAWAL',
        details: {
          withdrawal_id: withdrawalId,
          rejection_reason: rejectionReason || 'Rejected by administrator during security review.',
        },
        created_at: new Date().toISOString(),
      }).catch(() => null);

      return NextResponse.json({
        success: true,
        data: refundData,
        message: 'Withdrawal rejected and funds safely returned to user wallet.',
      });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

