import { verifyServerAdmin } from '@/lib/server-admin-auth';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyServerAdmin(request);
    if (!auth.authorized) {
      return auth.response!;
    }

    // This legacy endpoint settles p2p_orders through RPCs that do not guarantee
    // atomic escrow debit, wallet credit, ledger entries, and replay protection.
    // Fail closed until a canonical atomic p2p_orders settlement workflow is validated.
    return NextResponse.json(
      {
        success: false,
        error: 'Legacy P2P dispute settlement is unavailable pending verified atomic escrow accounting.',
      },
      { status: 503 },
    );
  } catch {
    return NextResponse.json(
      { success: false, error: 'Unable to process legacy P2P dispute settlement.' },
      { status: 500 },
    );
  }
}
