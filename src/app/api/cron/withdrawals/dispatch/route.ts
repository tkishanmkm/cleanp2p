import { NextResponse } from 'next/server';
import { processWithdrawalQueue } from '@/jobs/withdrawalWorker';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const auth = verifyWorkerAuth(req, {
      allowedSecrets: [
        process.env.WORKER_SECRET,
        process.env.CRON_SECRET,
        process.env.CRON_SECRET_KEY,
        process.env.WITHDRAWAL_WORKER_SECRET,
      ],
      customHeaderNames: ['x-cron-secret', 'x-worker-secret'],
    });

    if (!auth.authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[Cron Worker] Executing withdrawal dispatcher job...');
    const result = await processWithdrawalQueue();

    return NextResponse.json({ success: true, timestamp: new Date().toISOString(), result });
  } catch (err: any) {
    console.error('[Cron Dispatcher Error]:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
