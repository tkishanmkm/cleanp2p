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
        { success: false, error: 'Support administrators cannot approve withdrawals.' },
        { status: 403 }
      );
    }

    const callerId = auth.adminId || auth.user.id;
    const supabaseAdmin = getSupabaseAdminClient();

    // Parse request payload
    const body = await req.json().catch(() => null);
    const withdrawalId = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>).withdrawalId
      : null;
    const normalizedWithdrawalId = typeof withdrawalId === 'string' ? withdrawalId.trim() : '';
    const isWithdrawalIdValid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedWithdrawalId);

    if (!isWithdrawalIdValid) {
      return NextResponse.json(
        { error: 'Bad Request: Missing or invalid withdrawalId.' },
        { status: 400 }
      );
    }

    // 4. Call authoritative approve_withdrawal RPC
    const { data: approvalResult, error: rpcError } = await supabaseAdmin.rpc('approve_withdrawal', {
      p_withdrawal_id: normalizedWithdrawalId,
      p_admin_id: callerId,
    });

    if (rpcError) {
      console.error('[Admin Withdrawal Approval] RPC failed:', rpcError.message);
      return NextResponse.json(
        { error: 'Withdrawal approval failed; verify the withdrawal status before retrying.' },
        { status: 500 }
      );
    }

    // A successful HTTP/RPC transport does not mean the database transition succeeded.
    // Only report QUEUED when the authoritative RPC explicitly confirms success.
    const parsedResult = typeof approvalResult === 'string'
      ? (() => {
          try { return JSON.parse(approvalResult); } catch { return null; }
        })()
      : approvalResult;

    if (!parsedResult || parsedResult.success !== true) {
      console.error('[Admin Withdrawal Approval] RPC returned an unconfirmed result.');
      return NextResponse.json(
        { error: 'Withdrawal approval was not confirmed; review the withdrawal status before retrying.' },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      data: parsedResult,
      status: parsedResult.status || 'QUEUED',
      withdrawalId: normalizedWithdrawalId,
      approvedBy: callerId,
      message: 'Withdrawal approved and queued for broadcast.',
    });
  } catch (err: unknown) {
    console.error(
      '[Admin Withdrawal Approval] Unexpected request failure:',
      err instanceof Error ? err.name : 'UnknownError'
    );
    return NextResponse.json(
      { error: 'Internal server error; verify withdrawal status before retrying.' },
      { status: 500 }
    );
  }
}
