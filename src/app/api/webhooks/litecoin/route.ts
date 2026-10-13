import { NextResponse, type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

// Retired: the former handler trusted payload amount and confirmation fields
// and forwarded them to a privileged deposit-credit RPC.
export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { error: 'Litecoin deposit webhook retired pending independent chain verification.' },
    { status: 410 },
  );
}
