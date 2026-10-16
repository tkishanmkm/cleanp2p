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

    // Return operational counters only. Raw provider errors and per-transaction
    // details can expose transaction/address metadata to anyone holding the worker
    // credential and should remain in protected server logs.
    const summary = results.map((result) => ({
      network: result.network,
      depositsDetected: result.depositsDetected,
      depositsCredited: result.depositsCredited,
      errorCount: result.errors.length,
      scannedBlocks: result.scannedBlocks,
    }));

    return NextResponse.json({
      success: true,
      summary,
      pendingRecheck,
      message: 'Deposit ingestion cycle completed',
    });
  } catch (error: unknown) {
    console.error('Deposit worker error:', error);
    return NextResponse.json(
      { error: 'Deposit ingestion failed; check protected server logs.' },
      { status: 500 }
    );
  }
}
