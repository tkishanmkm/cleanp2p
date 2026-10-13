import { NextResponse } from 'next/server';

/**
 * Retired legacy endpoint.
 *
 * This route credited deposits from transaction input data and supplied a
 * hardcoded confirmation count to process_deposit_atomic. Neither is sufficient
 * evidence that a transfer was successful or sufficiently confirmed.
 *
 * Use the authenticated canonical deposit ingestion worker at
 * POST /api/workers/deposit-worker, which runs the shared ingestion pipeline.
 *
 * This route intentionally does not inspect request data, access the database,
 * or credit deposits. Any external scheduler using this legacy path must be
 * migrated before deploying this change.
 */
function retiredResponse() {
  return NextResponse.json(
    {
      error: 'This legacy deposit listener is retired.',
      code: 'DEPOSIT_LISTENER_RETIRED',
      replacement: 'POST /api/workers/deposit-worker',
    },
    {
      status: 410,
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}

export async function GET() {
  return retiredResponse();
}

export async function POST() {
  return retiredResponse();
}
