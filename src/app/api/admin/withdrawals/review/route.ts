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
    if (auth.supportAdmin === true) {
      return NextResponse.json(
        { success: false, error: 'Support administrators cannot review or refund withdrawals.' },
        { status: 403 }
      );
    }

    const adminId = auth.adminId || auth.user.id;
    const supabaseAdmin = getSupabaseAdminClient();

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'A valid JSON object is required.' }, { status: 400 });
    }

    const withdrawalId = typeof body.withdrawalId === 'string' ? body.withdrawalId.trim() : '';
    const action = body.action;
    const rejectionReason = typeof body.rejectionReason === 'string'
      ? body.rejectionReason.trim().slice(0, 1000)
      : 'Rejected by administrator during security review.';
    const isWithdrawalIdValid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(withdrawalId);

    if (!isWithdrawalIdValid || (action !== 'APPROVE' && action !== 'REJECT')) {
      return NextResponse.json({ error: 'Invalid payload parameters' }, { status: 400 });
    }

    if (action === 'APPROVE') {
      // Call authoritative approve_withdrawal RPC (verifies admin status and transitions state atomically)
      const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('approve_withdrawal', {
        p_withdrawal_id: withdrawalId,
        p_admin_id: adminId,
      });

      if (rpcError) {
        console.error('[Admin Withdrawal Review] Approval RPC failed:', rpcError.message);
        return NextResponse.json({ error: 'Withdrawal approval failed; review the withdrawal status before retrying' }, { status: 500 });
      }

      if (!rpcData || rpcData.success !== true) {
        console.error('[Admin Withdrawal Review] Approval RPC returned an unsuccessful result');
        return NextResponse.json({ error: 'Withdrawal approval was not confirmed' }, { status: 409 });
      }

      return NextResponse.json({
        success: true,
        data: rpcData,
        message: 'Withdrawal approved and queued for broadcast.',
      });
    } else {
      // Call authoritative refund procedure to safely return liability to available balance
      // Refund and audit are performed in one database transaction. If audit insertion fails,
      // the refund transaction rolls back instead of leaving an unaudited financial change.
      const { data: refundData, error: rpcError } = await supabaseAdmin.rpc('reject_withdrawal_pending_approval', {
        p_withdrawal_id: withdrawalId,
        p_admin_id: adminId,
        p_reason: rejectionReason,
      });

      if (rpcError) {
        console.error('[Admin Withdrawal Review] Rejection/refund RPC failed:', rpcError.message);
        return NextResponse.json({ error: 'Withdrawal rejection failed; reconciliation may be required' }, { status: 500 });
      }

      if (!refundData || refundData.success !== true) {
        return NextResponse.json({ error: 'Refund was not confirmed by the settlement procedure' }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        data: refundData,
        message: 'Withdrawal rejected and funds safely returned to user wallet.',
      });
    }
  } catch (err) {
    console.error('[Admin Withdrawal Review] Unexpected request failure:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

