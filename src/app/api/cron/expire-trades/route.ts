import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';

export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest): boolean {
  const result = verifyWorkerAuth(req, {
    allowedSecrets: [
      process.env.CRON_SECRET_KEY,
      process.env.CRON_SECRET,
      process.env.DEPOSIT_WORKER_SECRET,
    ],
    customHeaderNames: ['x-service-key', 'x-worker-secret'],
    checkQueryParam: true,
  });

  return result.authorized;
}

export async function GET(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseAdmin = getSupabaseAdminClient();
    const { data, error } = await supabaseAdmin.rpc('cancel_expired_p2p_trades');

    if (error) {
      console.error('[Expire Trades Error]:', error.message);
      return NextResponse.json({ error: 'Expired trade processing failed' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      result: data,
    });
  } catch (err: any) {
    console.error('[Expire Trades Route Error]:', err);
    return NextResponse.json({ error: 'Expired trade processing failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
