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
      console.error('[Withdrawal Approval] RPC failed:', {
        code: rpcError.code,
        details: rpcError.details,
        hint: rpcError.hint,
      });
      return NextResponse.json(
        { error: 'Failed to approve withdrawal.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // SECURITY DEFINER RPCs may return a business-level rejection as JSON
    // without raising a Postgres error. Never report approval unless its
    // returned result indicates success.
    const result =
      approvalResult && typeof approvalResult === 'object'
        ? approvalResult as Record<string, unknown>
        : null;
    if (
      !result ||
      result.success !== true ||
      result.approved === false ||
      ['FAILED', 'REJECTED', 'ERROR'].includes(String(result.status || '').toUpperCase())
    ) {
      return NextResponse.json(
        {
          error: 'Withdrawal was not approved.',
          code: String(result?.code || 'WITHDRAWAL_NOT_APPROVED'),
        },
        { status: 409, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    return NextResponse.json({
      success: true,
      status: typeof result.status === 'string' ? result.status : 'QUEUED',
      withdrawalId,
      approvedBy: callerId,
      message: 'Withdrawal approval request completed.',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error.';
    return NextResponse.json(
      { error: `Internal Server Error: ${message}` },
      { status: 500 }
    );
  }
}
