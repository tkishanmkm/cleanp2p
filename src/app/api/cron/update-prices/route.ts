import { NextResponse } from 'next/server';
import { runMarketPriceUpdate } from '@/jobs/priceUpdaterWorker';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    // 1. Authorization Verification
    const { searchParams } = new URL(request.url);
    const authHeader = request.headers.get('authorization');
    const secretKey = searchParams.get('key') || authHeader?.replace('Bearer ', '');

    if (process.env.CRON_SECRET_KEY && secretKey !== process.env.CRON_SECRET_KEY) {
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

