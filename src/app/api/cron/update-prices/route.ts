import { NextResponse } from 'next/server';
import { runMarketPriceUpdate } from '@/jobs/priceUpdaterWorker';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' };

export async function GET(request: Request) {
  try {
    // 1. Authorization Verification
    const auth = verifyWorkerAuth(request, {
      allowedSecrets: [
        process.env.CRON_SECRET_KEY,
        process.env.CRON_SECRET,
      ],
      customHeaderNames: ['x-service-key', 'x-worker-secret'],
      // Never put worker secrets in URLs, which can leak into access logs and history.
      checkQueryParam: false,
    });

    if (!auth.authorized) {
      return NextResponse.json({ error: 'Unauthorized request' }, { status: 401, headers: NO_STORE_HEADERS });
    }

    // 2. Invoke canonical price update logic
    const result = await runMarketPriceUpdate();

    if (!result.success) {
      const unavailable =
        result.error?.includes('UNAVAILABLE') ||
        result.error === 'SUPABASE_SERVICE_CONFIGURATION_MISSING';
      return NextResponse.json(
        {
          success: false,
          error: unavailable ? 'Market price service unavailable' : 'Market price update failed',
        },
        { status: unavailable ? 503 : 500, headers: NO_STORE_HEADERS }
      );
    }

    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (err: any) {
    console.error('[Market Prices Cron Route] Execution error:', err);
    return NextResponse.json({ success: false, error: 'Market price update failed' }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
