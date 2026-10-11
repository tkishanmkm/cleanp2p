import { NextRequest, NextResponse } from 'next/server';
import { runDepositIngestion } from '@/jobs/depositIngestion';
import { processAllPendingWithdrawals, checkSubmittedWithdrawals } from '@/jobs/withdrawalWorker';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 60 seconds maximum execution duration

function verifyCronAuthorization(req: NextRequest): boolean {
  return verifyWorkerAuth(req, {
    allowedSecrets: [process.env.CRON_SECRET, process.env.WORKER_SECRET],
    customHeaderNames: ['x-cron-secret'],
  }).authorized;
}

async function handleSync(req: NextRequest) {
  const startTime = Date.now();

  // 1. Authenticate secret
  if (!verifyCronAuthorization(req)) {
    return NextResponse.json(
      { error: 'Unauthorized: Invalid or missing CRON_SECRET header' },
      { status: 401 }
    );
  }

  try {
    // 2. Execute Inbound Deposit Ingestion Engine
    const depositSync = await runDepositIngestion();

    // 3. Execute Outbound Withdrawal Dispatch Worker
    const withdrawalSync = await processAllPendingWithdrawals(10);

    // 4. Verify Confirmations for Submitted Payouts
    const confirmationSync = await checkSubmittedWithdrawals();

    const executionDurationMs = Date.now() - startTime;

    return NextResponse.json(
      {
        success: true,
        timestamp: new Date().toISOString(),
        durationMs: executionDurationMs,
        depositIngestion: {
          scannedChains: depositSync.results.map((r) => ({
            network: r.network,
            detected: r.depositsDetected,
            credited: r.depositsCredited,
            errorsCount: r.errors.length,
          })),
          pendingRecheck: depositSync.pendingRecheck,
        },
        withdrawals: {
          processedCount: withdrawalSync.totalProcessed,
          results: withdrawalSync.results,
        },
        confirmations: {
          submittedChecked: confirmationSync.checked,
          newlyConfirmed: confirmationSync.confirmed,
        },
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error('[Blockchain Sync Cron] Unhandled error during sync cycle:', err);
    return NextResponse.json(
      {
        success: false,
        error: err.message || 'Internal error during blockchain synchronization',
        durationMs: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return handleSync(req);
}

export async function POST(req: NextRequest) {
  return handleSync(req);
}
