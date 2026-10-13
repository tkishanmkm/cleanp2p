import { NextResponse, type NextRequest } from 'next/server';

// Retired: webhook signatures alone do not prove canonical transaction,
// receipt/log, destination, amount, and confirmation state to the DB credit RPC.
export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { error: 'Alchemy deposit webhook retired pending independent chain verification.' },
    { status: 410 },
  );
}
