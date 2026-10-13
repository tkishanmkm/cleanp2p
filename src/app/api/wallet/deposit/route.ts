import { NextResponse } from 'next/server';

export async function POST() {
  // This legacy endpoint accepts caller-supplied transaction, amount, and destination
  // data and does not independently verify a chain transaction. Disable it until it
  // is replaced by an authenticated provider adapter plus chain verification.
  return NextResponse.json(
    { error: 'This deposit endpoint is disabled. Use the verified deposit ingestion pipeline.' },
    { status: 410 }
  );
}
