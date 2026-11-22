import { NextRequest, NextResponse } from 'next/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';
import {
  AdminBalanceAdjustmentError,
  adjustAdminWalletBalance,
} from '@/lib/admin-balance-adjustment';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized || !auth.adminId) {
      return auth.response || NextResponse.json(
        { success: false, error: 'Administrator authentication is required.' },
        { status: 401 },
      );
    }

    if (auth.supportAdmin === true) {
      return NextResponse.json(
        { success: false, error: 'Support administrators cannot adjust user balances.' },
        { status: 403 },
      );
    }

    const { userId } = await params;
    if (!UUID_PATTERN.test(userId || '')) {
      return NextResponse.json({ success: false, error: 'A valid target user ID is required.' }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ success: false, error: 'A valid JSON object is required.' }, { status: 400 });
    }

    const amount = typeof body.amount === 'number' ? body.amount : Number.NaN;
    const result = await adjustAdminWalletBalance({
      adminId: auth.adminId,
      adminEmail: auth.adminEmail || auth.user?.email || null,
      targetUserId: userId,
      asset: typeof body.asset === 'string' ? body.asset : '',
      action: body.action,
      amount,
      reason: typeof body.reason === 'string' ? body.reason : '',
      requestId: typeof body.requestId === 'string' ? body.requestId : '',
    });

    return NextResponse.json({ success: true, audit_logged: true, data: result });
  } catch (error) {
    if (error instanceof AdminBalanceAdjustmentError) {
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: error.statusCode },
      );
    }
    console.error('[API/ADMIN/USER_BALANCE] Atomic adjustment failed.');
    return NextResponse.json(
      { success: false, error: 'Unable to verify or complete the atomic wallet adjustment.' },
      { status: 500 },
    );
  }
}
