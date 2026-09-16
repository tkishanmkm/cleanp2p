import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

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

export async function GET(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseAdmin = getSupabaseAdminClient();
    const { data, error } = await supabaseAdmin.rpc('cancel_expired_p2p_trades');

    if (error) {
      console.error('[Expire Trades Error]:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      cancelled_count: data || 0,
    });
  } catch (err: any) {
    console.error('[Expire Trades Exception]:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}

