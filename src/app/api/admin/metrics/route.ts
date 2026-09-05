import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { getHotWalletOnchainBalance } from '@/lib/security/reconciliation';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key',
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export async function GET(req: NextRequest) {
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return req.cookies.getAll();
          },
        },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized: Session required' }, { status: 401 });
    }

    // Verify admin privileges
    const { data: isAdmin, error: adminErr } = await supabaseAdmin.rpc('check_is_admin', {
      p_user_id: user.id,
    });

    if (adminErr || !isAdmin) {
      return NextResponse.json({ error: 'Forbidden: Admin privilege required' }, { status: 403 });
    }

    // 1. Total Platform Volume (Completed P2P Trades)
    let totalVolumeUsdt = 0;
    let completedTradesCount = 0;
    try {
      const { data: completedTrades } = await supabaseAdmin
        .from('trades')
        .select('crypto_amount, fiat_amount, status')
        .in('status', ['COMPLETED', 'RELEASED']);

      if (completedTrades) {
        completedTradesCount = completedTrades.length;
        totalVolumeUsdt = completedTrades.reduce((acc, t) => acc + Number(t.crypto_amount || 0), 0);
      }
    } catch (_) {}

    // 2. Locked Escrow & Withdrawal Totals
    let totalLockedEscrow = 0;
    let totalLockedWithdrawal = 0;
    let totalAvailable = 0;
    try {
      const { data: assets } = await supabaseAdmin
        .from('wallet_assets')
        .select('asset_code, available, locked_escrow, locked_withdrawal');

      if (assets) {
        for (const a of assets) {
          if (a.asset_code === 'USDT') {
            totalAvailable += Number(a.available || 0);
            totalLockedEscrow += Number(a.locked_escrow || 0);
            totalLockedWithdrawal += Number(a.locked_withdrawal || 0);
          }
        }
      }
    } catch (_) {}

    // 3. Hot Wallet Reserves & Status (Primary: BSC, Optional: others)
    const hotWallets = [];
    const chainsToCheck = ['BEP20'];
    if (process.env.ETH_RPC_URL || process.env.EVM_RPC_URL) chainsToCheck.push('ERC20');
    if (process.env.POLYGON_RPC_URL) chainsToCheck.push('POLYGON');
    if (process.env.SEPOLIA_RPC_URL) chainsToCheck.push('SEPOLIA');
    if (process.env.TRON_HOT_WALLET_ADDRESS) chainsToCheck.push('TRC20');

    for (const chain of chainsToCheck) {
      const reserve = await getHotWalletOnchainBalance(chain, 'USDT');
      hotWallets.push(reserve);
    }

    // 4. Dispute Statistics
    let openDisputes = 0;
    let resolvedDisputes = 0;
    let totalDisputes = 0;
    try {
      const { data: disputes } = await supabaseAdmin
        .from('disputes')
        .select('id, status, created_at, resolved_at');

      if (disputes) {
        totalDisputes = disputes.length;
        for (const d of disputes) {
          if (['OPEN', 'INVESTIGATING', 'IN_REVIEW'].includes(d.status)) {
            openDisputes++;
          } else {
            resolvedDisputes++;
          }
        }
      }
    } catch (_) {}

    // 5. Active Security Alerts Count
    let activeAlertsCount = 0;
    try {
      const { count } = await supabaseAdmin
        .from('security_alerts')
        .select('*', { count: 'exact', head: true })
        .eq('is_resolved', false);
      activeAlertsCount = count || 0;
    } catch (_) {}

    // Log admin read action
    try {
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || '127.0.0.1';
      await supabaseAdmin.from('admin_audit_logs').insert({
        admin_id: user.id,
        action: 'VIEW_METRICS',
        details: { path: '/api/admin/metrics' },
        ip_address: ip,
      });
    } catch (_) {}

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      metrics: {
        trading: {
          totalVolumeUsdt,
          completedTradesCount,
        },
        liabilities: {
          totalAvailableUsdt: totalAvailable,
          totalLockedEscrowUsdt: totalLockedEscrow,
          totalLockedWithdrawalUsdt: totalLockedWithdrawal,
          totalPlatformLiabilityUsdt: totalAvailable + totalLockedEscrow + totalLockedWithdrawal,
        },
        hotWalletReserves: hotWallets,
        disputes: {
          total: totalDisputes,
          open: openDisputes,
          resolved: resolvedDisputes,
        },
        security: {
          activeAlertsCount,
        },
      },
    });
  } catch (err: any) {
    console.error('[Admin Metrics API] Unhandled error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error while fetching admin metrics' },
      { status: 500 }
    );
  }
}
