import { NextResponse } from 'next/server';

// Retired because the request payload cannot establish on-chain inclusion,
// destination ownership, amount, or confirmations.
export async function POST() {
  return NextResponse.json(
    { error: 'Direct deposit API retired: use verified chain ingestion.' },
    { status: 410 }
  );
}
