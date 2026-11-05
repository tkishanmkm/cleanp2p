import { NextResponse } from 'next/server';
import { runMarketPriceUpdate } from '@/jobs/priceUpdaterWorker';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    // 1. Authorization Verification
    const auth = verifyWorkerAuth(request, {
      allowedSecrets: [
        process.env.CRON_SECRET_KEY,
        process.env.CRON_SECRET,
      ],
      customHeaderNames: ['x-service-key', 'x-worker-secret'],
      });

    if (!auth.authorized) {
      return NextResponse.json({ error: 'Unauthorized request' }, { status: 401 });
    }

    // 2. Invoke canonical price update logic
    const result = await runMarketPriceUpdate();

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.error?.includes('UNAVAILABLE') ? 503 : 500 }
      );
    }

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[Market Prices Cron Route] Execution error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
