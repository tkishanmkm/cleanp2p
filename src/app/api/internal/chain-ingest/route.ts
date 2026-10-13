import { NextResponse, type NextRequest } from 'next/server';

// Retired: a shared-secret header authenticates possession of a secret but
// does not independently prove the supplied chain facts or confirmations.
export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { error: 'Internal chain ingestion retired pending independently verified deposit processing.' },
    { status: 410 },
  );
}
