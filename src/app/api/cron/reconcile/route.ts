import { NextResponse } from 'next/server';
import { reconcileLedgerVsChain } from '@/jobs/reconciliationWorker';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    const isValidSecret =
      authHeader === `Bearer ${process.env.WORKER_SECRET}` ||
      (Boolean(process.env.CRON_SECRET) && authHeader === `Bearer ${process.env.CRON_SECRET}`);

    if (!isValidSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[Cron Worker] Executing reconciliation & gas check...');
    const result = await reconcileLedgerVsChain();

    return NextResponse.json({ success: true, timestamp: new Date().toISOString(), result });
  } catch (err: any) {
    console.error('[Cron Reconciliation Error]:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
