import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

async function verifyAdmin(token: string) {
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    return { user: null, error: 'Invalid token' };
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, is_admin')
    .eq('id', user.id)
    .maybeSingle();

  const normalizedRole = (profile?.role || '').toUpperCase();
  const isUserAdmin =
    normalizedRole === 'ADMIN' ||
    normalizedRole === 'SUPER_ADMIN' ||
    Boolean(profile?.is_admin);

  if (!isUserAdmin) {
    const { data: adminRecord } = await supabaseAdmin
      .from('app_admins')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!adminRecord) {
      return { user: null, error: 'Forbidden: Admin access required' };
    }
  }

  return { user, error: null };
}

// GET: Fetch active (unresolved) system alerts
export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const { user, error: authError } = await verifyAdmin(token);
    if (authError || !user) {
      return NextResponse.json({ error: authError || 'Unauthorized' }, { status: authError?.startsWith('Forbidden') ? 403 : 401 });
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
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const { user, error: authError } = await verifyAdmin(token);
    if (authError || !user) {
      return NextResponse.json({ error: authError || 'Unauthorized' }, { status: authError?.startsWith('Forbidden') ? 403 : 401 });
    }

    const body = await req.json().catch(() => ({}));
    const alertId = body.alertId;
    if (!alertId) {
      return NextResponse.json({ error: 'Alert ID required' }, { status: 400 });
    }

    // Attempt RPC first
    const { error: rpcError } = await supabaseAdmin.rpc('resolve_system_alert', {
      p_alert_id: alertId,
      p_admin_id: user.id,
    });

    if (rpcError) {
      // Direct update fallback
      const { error: updateError } = await supabaseAdmin
        .from('system_alerts')
        .update({
          is_resolved: true,
          resolved_by: user.id,
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
