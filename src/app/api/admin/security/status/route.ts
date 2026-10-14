import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { getAdminSecurityState } from '@/lib/admin-security';
import { verifyServerAdmin } from '@/lib/server-admin-auth';

export async function GET(req: NextRequest) {
  const auth = await verifyServerAdmin(req);
  if (!auth.authorized) return auth.response!;

  try {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminId = session.user.id;
    const adminDb = getSupabaseAdminClient();

    const state = await getAdminSecurityState(adminId);
    if (!state) {
      return NextResponse.json({ error: 'Admin profile not found' }, { status: 404 });
    }

    // Fetch recent 2FA security audit logs
    const { data: logs } = await adminDb
      .from('admin_audit_logs')
      .select('id, action, target_type, target_id, details, ip_address, created_at')
      .eq('admin_id', adminId)
      .ilike('action', 'ADMIN_2FA%')
      .order('created_at', { ascending: false })
      .limit(10);

    return NextResponse.json({
      success: true,
      state,
      logs: logs || [],
    });
  } catch (error: any) {
    console.error('Admin Security Status Error:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch status' }, { status: 500 });
  }
}
