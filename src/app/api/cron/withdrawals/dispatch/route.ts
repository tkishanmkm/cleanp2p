import { NextResponse } from 'next/server';
import { processPendingWithdrawals } from '@/jobs/withdrawalWorker';

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

    console.log('[Cron Worker] Executing withdrawal dispatcher job...');
    const result = await processPendingWithdrawals();

    return NextResponse.json({ success: true, timestamp: new Date().toISOString(), result });
  } catch (err: any) {
    console.error('[Cron Dispatcher Error]:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
