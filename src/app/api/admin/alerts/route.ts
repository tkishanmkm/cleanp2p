import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyServerAdmin } from '@/lib/server-admin-auth';

export const dynamic = 'force-dynamic';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  'https://placeholder.supabase.co';

const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'placeholder-key';

const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

// GET: Fetch active (unresolved) system alerts
export async function GET(req: NextRequest) {
  try {
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized) {
      return (
        auth.response ||
        NextResponse.json({ error: 'Unauthorized: Admin privileges required' }, { status: 401 })
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
