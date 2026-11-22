import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Retired development-only recovery diagnostic.
 * The former GET handler triggered deposit ingestion and exposed hard-coded
 * user/deposit records without authentication. Recovery must use an explicitly
 * authenticated operator workflow, not a public diagnostic URL.
 */
export async function GET() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
