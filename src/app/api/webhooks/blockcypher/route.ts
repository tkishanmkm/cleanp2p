import { NextResponse } from 'next/server';

// Retired: the former handler accepted unsigned provider payloads and passed
// caller-controlled amounts/confirmations to the privileged deposit RPC.
export async function POST() {
  return NextResponse.json(
    { error: 'Deposit webhook retired pending independent chain verification.' },
    { status: 410 },
  );
}
