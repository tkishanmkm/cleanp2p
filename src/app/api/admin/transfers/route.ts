import { NextRequest, NextResponse } from 'next/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyServerAdmin(request);
    if (!auth.authorized) return auth.response!;
    if (auth.supportAdmin === true) {
      return NextResponse.json(
        { success: false, error: 'Full administrator access is required to view platform transfers.' },
        { status: 403 }
      );
    }

    const url = new URL(request.url);
    const rawLimit = Number(url.searchParams.get('limit') || 500);
    const limit = Number.isInteger(rawLimit) ? Math.max(1, Math.min(rawLimit, 1000)) : 500;

    const admin = getSupabaseAdminClient();
    const { data, error } = await admin
      .from('transfers')
      .select('id,public_id,sender_id,sender_username,recipient_id,recipient_username,crypto,amount,fee_amount,status,created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !Array.isArray(data)) {
      console.error('[ADMIN_TRANSFERS] Transfer read failed:', error?.code || 'invalid_response');
      return NextResponse.json(
        { success: false, error: 'Transfer history could not be loaded.' },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { success: true, data },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error: unknown) {
    console.error('[ADMIN_TRANSFERS] Unexpected read failure:', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json(
      { success: false, error: 'Transfer history could not be loaded.' },
      { status: 500 }
    );
  }
}
