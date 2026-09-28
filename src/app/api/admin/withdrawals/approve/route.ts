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

    const callerId = auth.adminId || auth.user.id;
    const supabaseAdmin = getSupabaseAdminClient();

    // Parse request payload
    const body = await req.json().catch(() => ({}));
    const { withdrawalId } = body;

    if (!withdrawalId || typeof withdrawalId !== 'string') {
      return NextResponse.json(
        { error: 'Bad Request: Missing or invalid withdrawalId.' },
        { status: 400 }
      );
    }

    // 4. Call authoritative approve_withdrawal RPC
    const { data: approvalResult, error: rpcError } = await supabaseAdmin.rpc('approve_withdrawal', {
      p_withdrawal_id: withdrawalId,
      p_admin_id: callerId,
    });

    if (rpcError) {
      return NextResponse.json(
        { error: rpcError.message || 'Failed to approve withdrawal' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      status: 'QUEUED',
      withdrawalId,
      approvedBy: callerId,
      message: 'Withdrawal approved and queued for broadcast.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error.';
    return NextResponse.json(
      { error: `Internal Server Error: ${message}` },
      { status: 500 }
    );
  }
}
