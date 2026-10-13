import { NextResponse } from 'next/server';

// This diagnostic endpoint previously used a server-side service-role client
// to call process_deposit_atomic with hard-coded transaction details and a
// caller-supplied confirmation count. It could mutate financial state on GET.
// Retire it until a non-mutating, authenticated diagnostic endpoint is designed.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(
    { error: 'This diagnostic endpoint has been retired.' },
    { status: 410 },
  );
}
