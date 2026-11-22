import { verifyServerAdmin } from '@/lib/server-admin-auth';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * The legacy p2p_orders dispute flow credits wallet_balances directly and is
 * not atomic with canonical wallet_assets escrow settlement. Keep it blocked
 * until disputes are mapped to the canonical trades/disputes settlement RPC.
 */
export async function POST(request: NextRequest) {
  const auth = await verifyServerAdmin(request);
  if (!auth.authorized) {
    return auth.response!;
  }

  return NextResponse.json(
    {
      error: 'Legacy P2P order dispute settlement is disabled because it cannot safely reconcile canonical escrow and wallet balances. Resolve disputes through the canonical trade dispute workflow.',
      code: 'LEGACY_ORDER_DISPUTE_SETTLEMENT_DISABLED',
    },
    { status: 409 }
  );
}
