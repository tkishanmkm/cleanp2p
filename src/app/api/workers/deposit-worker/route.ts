import { NextResponse } from 'next/server';
import { runDepositIngestion } from '@/jobs/depositIngestion';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';

export async function POST(request: Request) {
  try {
    const auth = verifyWorkerAuth(request, {
      allowedSecrets: [process.env.DEPOSIT_WORKER_SECRET],
      customHeaderNames: ['x-worker-secret', 'x-deposit-worker-secret'],
    });

    if (!auth.authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ingestion = await runDepositIngestion();
    const success = ingestion.ok && ingestion.errorCount === 0;

    return NextResponse.json({
      success,
      errorCount: ingestion.errorCount,
      results: ingestion.results,
      pendingRecheck: ingestion.pendingRecheck,
      message: success
        ? 'Deposit scan completed without reported errors; automatic credit remains disabled pending a validated credit trust boundary.'
        : 'Deposit scan reported errors; deposits may remain pending because automatic credit is fail-closed.',
    }, { status: success ? 200 : 500 });
  } catch (error: any) {
    console.error('Deposit worker error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
