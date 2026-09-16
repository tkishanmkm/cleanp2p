import { NextRequest, NextResponse } from 'next/server';
import { runDepositIngestion } from '@/jobs/depositIngestion';

// 1. Force dynamic execution (Prevents Next.js build-time static caching)
export const dynamic = 'force-dynamic';

// 2. Allow execution time up to 30 seconds on Render
export const maxDuration = 30;

function isAuthorized(req: NextRequest): boolean {
  const secretKey =
    process.env.CRON_SECRET_KEY?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    process.env.DEPOSIT_WORKER_SECRET?.trim();
  if (!secretKey) return true;

  const authHeader = req.headers.get('authorization');
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  const urlKey = req.nextUrl.searchParams.get('key');
  const serviceKey = req.headers.get('x-service-key') || req.headers.get('x-worker-secret');

  return token === secretKey || urlKey === secretKey || serviceKey === secretKey;
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      console.warn('[CRON INDEXER] Unauthorized attempt');
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