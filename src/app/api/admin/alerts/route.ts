import { NextRequest, NextResponse } from 'next/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// GET: Fetch active (unresolved) system alerts
export async function GET(req: NextRequest) {
  try {
    const auth = await verifyServerAdmin(req, { allowSupportReadOnly: true });
    if (!auth.authorized) return auth.response!;
    if (auth.supportAdmin === true || auth.supportReadOnly === true) {
      return NextResponse.json(
        { success: false, error: 'Full administrator access is required to view platform security alerts.' },
        { status: 403 }
      );
    }

    const { data: alerts, error } = await supabaseAdmin
      .from('system_alerts')
      .select('*')
      .eq('is_resolved', false)
      .order('created_at', { ascending: false });

    if (error) {
      // If table doesn't exist yet or is empty
      console.warn('[Admin Alerts] Fetch warning:', error.message);
      return NextResponse.json({ success: true, alerts: [] });
    }

    return NextResponse.json({ success: true, alerts: alerts || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST: Resolve / Dismiss an alert
export async function POST(req: NextRequest) {
  try {
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized) {
      return (
        auth.response ||
        NextResponse.json({ error: 'Unauthorized: Admin privileges required' }, { status: 401 })
      );
    }

    const adminUserId = auth.adminId || auth.user?.id;

    const body = await req.json().catch(() => ({}));
    const alertId = body.alertId;
    if (!alertId) {
      return NextResponse.json({ error: 'Alert ID required' }, { status: 400 });
    }

    // Attempt RPC first
    const { error: rpcError } = await supabaseAdmin.rpc('resolve_system_alert', {
      p_alert_id: alertId,
      p_admin_id: adminUserId,
    });

    if (rpcError) {
      // Direct update fallback
      const { error: updateError } = await supabaseAdmin
        .from('system_alerts')
        .update({
          is_resolved: true,
          resolved_by: adminUserId,
          resolved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', alertId);

      if (updateError) {
        throw updateError;
      }
    }

    return NextResponse.json({ success: true, message: 'Alert resolved' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
