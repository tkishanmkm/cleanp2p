import { NextRequest, NextResponse } from 'next/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tradeId: string }> }
) {
  try {
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized) {
      return auth.response!;
    }

    if (auth.supportAdmin === true) {
      return NextResponse.json(
        { success: false, error: 'Support administrators cannot resolve disputes or settle escrow.' },
        { status: 403 },
      );
    }

    // This alternate trade-ID endpoint also settled escrow and then updated dispute
    // metadata in separate requests. Keep it disabled until one verified atomic RPC
    // handles the financial outcome, dispute state, and idempotency together.
    return NextResponse.json(
      {
        success: false,
        error: 'Dispute settlement is temporarily unavailable until atomic settlement and audit bookkeeping are verified.',
        code: 'DISPUTE_ATOMIC_SETTLEMENT_UNVERIFIED',
      },
      { status: 503 },
    );
  } catch {
    return NextResponse.json({ error: 'Unable to resolve dispute.' }, { status: 500 });
  }
}
