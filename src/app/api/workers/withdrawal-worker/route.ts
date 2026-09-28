import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { processWithdrawalQueue } from '@/jobs/withdrawalWorker';

export const dynamic = 'force-dynamic';

const WORKER_SECRET = process.env.WITHDRAWAL_WORKER_SECRET || process.env.WORKER_SECRET;

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    if (WORKER_SECRET && authHeader !== `Bearer ${WORKER_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized worker invocation' }, { status: 401 });
    }

    const result = await processWithdrawalQueue();

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error: any) {
    console.error('[Withdrawal Worker] Fatal route error:', error.message);
    return NextResponse.json({ error: error.message || 'Withdrawal worker failed' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return POST(req);
}
