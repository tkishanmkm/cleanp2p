import { NextRequest, NextResponse } from 'next/server';
import { runDepositIngestion } from '@/jobs/depositIngestion';

// 1. Force dynamic execution (Prevents Next.js build-time static caching)
export const dynamic = 'force-dynamic';

// 2. Allow execution time up to 30 seconds on Render
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  try {
    // 1. Verify Security Token Header
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET || process.env.CRON_SECRET_KEY;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[CRON INDEXER] Unauthorized attempt:', authHeader);
      return NextResponse.json({ error: 'Unauthorized request' }, { status: 401 });
    }

    // 2. Run Indexing Routines for Multi-Chain Networks
    console.log('[CRON INDEXER] Triggered successfully at:', new Date().toISOString());

    // Trigger your network event indexers (ETH, BSC, TRON, etc.)
    const indexerResult = await runDepositIngestion();

    return NextResponse.json({
      success: true,
      message: 'Multi-chain indexer executed successfully',
      timestamp: new Date().toISOString(),
      details: {
        chainsIndexed: indexerResult?.results?.map((r: any) => ({
          network: r.network,
          detected: r.depositsDetected,
          credited: r.depositsCredited,
        })) || [],
        pendingRecheck: indexerResult?.pendingRecheck || 0,
      },
    }, { status: 200 });

  } catch (error: any) {
    console.error('[CRON INDEXER ERROR]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}