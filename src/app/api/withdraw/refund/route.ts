import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = verifyWorkerAuth(req, {
    allowedSecrets: [
      process.env.WITHDRAWAL_WORKER_SECRET,
      process.env.WORKER_SECRET,
    ],
    customHeaderNames: ['x-worker-secret', 'x-withdrawal-worker-secret'],
  });

  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized worker' }, { status: 401 });
  }

  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const body = await req.json();
    const withdrawalId = body?.withdrawalId;
    const reason = body?.reason;

    if (typeof withdrawalId !== 'string' || !withdrawalId.trim()) {
      return NextResponse.json({ error: 'Missing or invalid withdrawalId' }, { status: 400 });
    }

    const { data: refundData, error: rpcError } = await supabaseAdmin.rpc('process_failed_withdrawal', {
      p_withdrawal_id: withdrawalId,
      p_error_reason: reason || 'Manual refund requested',
    });

    if (rpcError) {
      console.error('[Refund Route] Authoritative process_failed_withdrawal RPC failed:', rpcError.message);
      return NextResponse.json(
        { error: 'Refund processing failed; reconciliation may be required' },
        { status: 500 }
      );
    }

    if (!refundData || refundData.success !== true) {
      console.error('[Refund Route] Refund RPC returned an unsuccessful result:', refundData);
      return NextResponse.json({ error: 'Refund was not confirmed by the settlement procedure' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Withdrawal refunded successfully' });
  } catch (err) {
    console.error('[Refund Route] Unexpected refund request failure:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
