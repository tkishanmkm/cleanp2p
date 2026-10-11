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
    const { withdrawalId, reason } = await req.json();

    if (!withdrawalId) {
      return NextResponse.json({ error: 'Missing withdrawalId' }, { status: 400 });
    }

    const { error: rpcError } = await supabaseAdmin.rpc('process_failed_withdrawal', {
      p_withdrawal_id: withdrawalId,
      p_error_reason: reason || 'Manual refund requested',
      p_is_verified_unbroadcast: true,
    });

    if (rpcError) {
      console.error('[Refund Route] Authoritative process_failed_withdrawal RPC failed:', rpcError.message);
      return NextResponse.json(
        { error: `Refund processing failed: ${rpcError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: 'Withdrawal refunded successfully' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
