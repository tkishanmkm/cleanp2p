import { NextRequest, NextResponse } from 'next/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';
import {
  AdminDisputeSettlementError,
  resolveDisputeAtomically,
  type DisputeResolution,
} from '@/lib/admin-dispute-settlement';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
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
        { success: false, error: 'Support administrators cannot resolve disputes or settle escrow.' },
        { status: 403 },
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ success: false, error: 'A valid JSON object is required.' }, { status: 400 });
    }

    const requestedResolution = typeof body.resolution === 'string'
      ? body.resolution.trim().toUpperCase()
      : undefined;
    if (requestedResolution && requestedResolution !== 'RELEASE' && requestedResolution !== 'CANCEL') {
      return NextResponse.json({ success: false, error: 'Resolution must be RELEASE or CANCEL.' }, { status: 400 });
    }

    const reason = typeof body.reason === 'string'
      ? body.reason
      : typeof body.notes === 'string'
        ? body.notes
        : '';

    const result = await resolveDisputeAtomically({
      disputeId: typeof body.disputeId === 'string' ? body.disputeId : undefined,
      tradeId: typeof body.tradeId === 'string' ? body.tradeId : '',
      winnerId: typeof body.winnerId === 'string' ? body.winnerId : undefined,
      resolution: requestedResolution as DisputeResolution | undefined,
      reason,
      actorId: auth.adminId,
      actorEmail: auth.adminEmail || auth.user?.email || null,
    });

    return NextResponse.json({
      success: true,
      settlementSucceeded: result.settlementSucceeded,
      audit_logged: result.audit_logged,
      data: result,
    });
  } catch (error) {
    if (error instanceof AdminDisputeSettlementError) {
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: error.statusCode },
      );
    }
    console.error('[API/ADMIN/DISPUTES/RESOLVE] Unexpected settlement error.');
    return NextResponse.json(
      { success: false, error: 'Unable to verify or complete the atomic dispute settlement.' },
      { status: 500 },
    );
  }
}
