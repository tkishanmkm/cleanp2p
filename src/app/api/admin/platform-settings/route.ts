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
      .eq('id', 1)
      .maybeSingle();

    // Check if caller is admin
    const auth = await verifyServerAdmin(req);
    const isAdmin = auth.authorized;

    if (!isAdmin) {
      // Return only safe public fields for non-admin callers
      return NextResponse.json({
        withdrawals_enabled: settings?.withdrawals_enabled !== false,
        maintenance_mode: Boolean(settings?.maintenance_mode),
        p2p_trading_enabled: settings?.p2p_trading_enabled !== false,
        updated_at: settings?.updated_at || new Date().toISOString(),
      });
    }

    // Full settings for authenticated admins
    return NextResponse.json({
      withdrawals_enabled: settings?.withdrawals_enabled !== false,
      global_kill_switch_active: Boolean(settings?.global_kill_switch_active),
      maintenance_mode: Boolean(settings?.maintenance_mode),
      p2p_trading_enabled: settings?.p2p_trading_enabled !== false,
      withdrawal_fee_multiplier: Number(settings?.withdrawal_fee_multiplier || 2.0),
      withdrawal_approval_threshold_usd: Number(settings?.withdrawal_approval_threshold_usd || 2000.0),
      max_single_withdrawal_usd: Number(settings?.max_single_withdrawal_usd || 4000.0),
      daily_withdrawal_limit_usd: Number(settings?.daily_withdrawal_limit_usd || 10000.0),
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
    const {
      withdrawals_enabled,
      global_kill_switch_active,
      maintenance_mode,
      p2p_trading_enabled,
      withdrawal_fee_multiplier,
      withdrawal_approval_threshold_usd,
      max_single_withdrawal_usd,
      daily_withdrawal_limit_usd,
    } = body;

    const supabase = getSupabaseAdminClient();
    const adminEmail = auth.adminEmail || 'admin@paxones.com';
    const adminId = auth.adminId || auth.user.id;

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (typeof withdrawals_enabled === 'boolean') {
      updatePayload.withdrawals_enabled = withdrawals_enabled;
    }
    if (typeof global_kill_switch_active === 'boolean') {
      updatePayload.global_kill_switch_active = global_kill_switch_active;
    }
    if (typeof maintenance_mode === 'boolean') {
      updatePayload.maintenance_mode = maintenance_mode;
    }
    if (typeof p2p_trading_enabled === 'boolean') {
      updatePayload.p2p_trading_enabled = p2p_trading_enabled;
    }

    // Withdrawal governance settings
    if (withdrawal_fee_multiplier !== undefined && !isNaN(Number(withdrawal_fee_multiplier))) {
      const mult = Number(withdrawal_fee_multiplier);
      if (mult >= 1.0 && mult <= 10.0) {
        updatePayload.withdrawal_fee_multiplier = mult;
      }
    }

    if (withdrawal_approval_threshold_usd !== undefined && !isNaN(Number(withdrawal_approval_threshold_usd))) {
      const thresh = Number(withdrawal_approval_threshold_usd);
      if (thresh > 0) {
        updatePayload.withdrawal_approval_threshold_usd = thresh;
      }
    }

    if (max_single_withdrawal_usd !== undefined && !isNaN(Number(max_single_withdrawal_usd))) {
      const maxSingle = Number(max_single_withdrawal_usd);
      if (maxSingle > 0) {
        updatePayload.max_single_withdrawal_usd = maxSingle;
      }
    }

    if (daily_withdrawal_limit_usd !== undefined && !isNaN(Number(daily_withdrawal_limit_usd))) {
      const daily = Number(daily_withdrawal_limit_usd);
      if (daily > 0) {
        updatePayload.daily_withdrawal_limit_usd = daily;
      }
    }

    const { error } = await supabase
      .from('platform_settings')
      .upsert({
        id: 1,
        ...updatePayload,
      }, { onConflict: 'id' });

    if (error) {
      console.warn('Upsert platform_settings error:', error);
    }

    // Record immutable admin audit log
    await supabase.from('admin_audit_logs').insert({
      admin_id: adminId,
      admin_email: adminEmail,
      action: 'UPDATE_GLOBAL_PLATFORM_SETTINGS',
      details: updatePayload,
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      message: 'Platform settings updated successfully.',
      settings: updatePayload,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
