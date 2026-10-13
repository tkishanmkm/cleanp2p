import { NextResponse } from 'next/server';

// Retired until deposit events are independently verified against canonical chain data
// and the database credit RPC no longer trusts caller-supplied confirmation counts.
export async function POST() {
  return NextResponse.json(
    { error: 'Deposit webhook retired: verified ingestion is not enabled.' },
    { status: 410 }
  );
}
