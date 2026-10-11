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

    const { results, pendingRecheck } = await runDepositIngestion();

    return NextResponse.json({
      success: true,
      results,
      pendingRecheck,
      message: 'Deposit ingestion completed via canonical process_deposit_atomic',
    });
  } catch (error: any) {
    console.error('Deposit worker error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
