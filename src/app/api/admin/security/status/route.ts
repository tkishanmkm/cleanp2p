import { NextRequest, NextResponse } from 'next/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { getAdminSecurityState } from '@/lib/admin-security';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized) return auth.response!;
    if (auth.supportAdmin === true) {
      return NextResponse.json({ success: false, error: 'Support administrators cannot access full-admin security settings.' }, { status: 403 });
    }

    const adminId = auth.user.id;
    const state = await getAdminSecurityState(adminId);
    if (!state) {
      return NextResponse.json({ success: false, error: 'Administrator security state could not be verified.' }, { status: 503 });
    }

    const adminDb = getSupabaseAdminClient();
    const { data: logs, error: logsError } = await adminDb
      .from('admin_audit_logs')
      .select('id, action, target_id, details, created_at')
      .eq('admin_id', adminId)
      .ilike('action', 'ADMIN_2FA%')
      .order('created_at', { ascending: false })
      .limit(10);

    if (logsError || !Array.isArray(logs)) {
      console.error('[ADMIN_SECURITY_STATUS] Audit read failed:', logsError?.code || 'invalid_response');
      return NextResponse.json({ success: false, error: 'Administrator security audit history could not be loaded.' }, { status: 503 });
    }

    return NextResponse.json(
      { success: true, state, logs },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error: unknown) {
    console.error('[ADMIN_SECURITY_STATUS] Read failed:', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ success: false, error: 'Administrator security state could not be loaded.' }, { status: 500 });
  }
}
