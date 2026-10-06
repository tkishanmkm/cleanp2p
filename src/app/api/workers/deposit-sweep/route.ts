import { NextRequest, NextResponse } from 'next/server';
import { SYSTEM_CONFIG } from '@/lib/config/env';
import { deriveUserKeys } from '@/lib/crypto/hd-engine';
import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key'
);

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    const urlKey = req.nextUrl.searchParams.get('key');
    const expectedSecret =
      process.env.CRON_SECRET_KEY?.trim() ||
      process.env.CRON_SECRET?.trim() ||
      process.env.DEPOSIT_WORKER_SECRET?.trim() ||
      SYSTEM_CONFIG.secrets.depositWorker ||
      SYSTEM_CONFIG.secrets.cron;

    if (expectedSecret && token !== expectedSecret && urlKey !== expectedSecret) {
      return NextResponse.json({ error: 'Unauthorized: Invalid worker secret' }, { status: 401 });
    }

    const { runDepositSweeper } = await import('@/jobs/sweeperWorker');
    const result = await runDepositSweeper();
    return NextResponse.json({ success: true, mode: 'automated_queue', timestamp: new Date().toISOString(), result });
  } catch (err: any) {
    console.error('Deposit sweep GET error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return NextResponse.json(
    {
      error: 'DEPRECATED_ENDPOINT',
      message: 'Direct transaction broadcast via legacy deposit-sweep POST is decommissioned. All on-chain deposits must be ingested via canonical depositIngestion workers, and all sweeps must be orchestrated via the hardened sweeperWorker (runDepositSweeper) with pre-broadcast persistence.',
      decommissioned: true,
      timestamp: new Date().toISOString(),
    },
    { status: 410 }
  );
}

