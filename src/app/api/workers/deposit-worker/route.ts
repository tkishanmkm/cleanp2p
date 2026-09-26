import { NextResponse } from 'next/server';
import { runDepositIngestion } from '@/jobs/depositIngestion';

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    const workerSecret = process.env.DEPOSIT_WORKER_SECRET;
    if (workerSecret && authHeader !== `Bearer ${workerSecret}`) {
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
