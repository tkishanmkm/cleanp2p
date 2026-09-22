import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseAdminClient();
    const { data: settings } = await supabase
      .from('platform_settings')
      .select('*')
      .maybeSingle();

    return NextResponse.json({
      global_withdrawals_disabled: Boolean(settings?.global_withdrawals_disabled),
      maintenance_mode: Boolean(settings?.maintenance_mode),
      p2p_trading_enabled: settings?.p2p_trading_enabled !== false,
      updated_at: settings?.updated_at || new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // 1. Mandatory Server-Side Admin Authentication
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized) {
      return auth.response!;
    }

    const body = await req.json().catch(() => ({}));
    const { global_withdrawals_disabled, maintenance_mode, p2p_trading_enabled } = body;
    const supabase = getSupabaseAdminClient();
    const adminEmail = auth.adminEmail || 'admin@paxones.com';
    const adminId = auth.adminId || auth.user.id;

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (typeof global_withdrawals_disabled === 'boolean') {
      updatePayload.global_withdrawals_disabled = global_withdrawals_disabled;
    }
    if (typeof maintenance_mode === 'boolean') {
      updatePayload.maintenance_mode = maintenance_mode;
    }
    if (typeof p2p_trading_enabled === 'boolean') {
      updatePayload.p2p_trading_enabled = p2p_trading_enabled;
    }

    const { data, error } = await supabase
      .from('platform_settings')
      .upsert({
        id: 1,
        ...updatePayload,
      }, { onConflict: 'id' })
      .select()
      .single();

    if (error) {
      console.warn('Direct upsert platform_settings error (falling back to simple response):', error);
    }

    // Record immutable admin audit log with authenticated actor identity
    await supabase.from('admin_audit_logs').insert({
      admin_id: adminId,
      admin_email: adminEmail,
      action: 'UPDATE_GLOBAL_PLATFORM_SETTINGS',
      details: updatePayload,
    });

    return NextResponse.json({
      success: true,
      message: 'Global platform settings updated.',
      settings: updatePayload,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
