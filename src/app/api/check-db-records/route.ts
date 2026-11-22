import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Retired development-only diagnostic endpoint.
 * It previously returned hard-coded user/deposit records without authentication.
 * Keep the route closed so stale deployments fail safely rather than expose data.
 */
export async function GET() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
