import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';
import { getHotWalletOnchainBalance } from '@/lib/security/reconciliation';
import { normalizePrimaryWalletAssetBalance } from '@/lib/wallet-balance-normalization';
import { fetchAllSupabaseRows } from '@/lib/supabase/fetch-all-pages';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await verifyServerAdmin(req, { allowSupportReadOnly: true });
    if (!auth.authorized) return auth.response!;
    if (auth.supportAdmin === true || auth.supportReadOnly === true) {
      return NextResponse.json(
        { success: false, error: 'Full administrator access is required for platform-wide financial metrics.' },
        { status: 403 }
      );
    }

    const supabaseAdmin = getSupabaseAdminClient();

    // 1. P2P trade volume uses the immutable USD-equivalent snapshot captured
    // at trade initiation. Never sum BTC/ETH quantities and label them USDT.
    const completedTradesResult = await fetchAllSupabaseRows<any>(
      (from, to) => supabaseAdmin
        .from('trades')
        .select('usd_value_at_trade', { count: 'exact' })
        .in('status', ['released', 'RELEASED', 'completed', 'COMPLETED'])
        .range(from, to),
      { pageSize: 1000, maxRows: 20000 }
    );
    if (completedTradesResult.error || completedTradesResult.truncated) {
      console.error('[ADMIN_METRICS] Completed-trade volume read failed or exceeded the safe cap.');
      return NextResponse.json({ success: false, error: 'Completed trade metrics could not be fully verified.' }, { status: 503 });
    }
    const completedTrades = completedTradesResult.rows;

    let completedTradesCount = completedTrades.length;
    let totalVolumeUsdt = 0;
    let unpricedCompletedTradesCount = 0;
    for (const trade of completedTrades) {
      const usdValue = Number(trade.usd_value_at_trade);
      if (!Number.isFinite(usdValue) || usdValue < 0) {
        unpricedCompletedTradesCount += 1;
        continue;
      }
      totalVolumeUsdt += usdValue;
    }

    // 2. Canonical wallet-asset liabilities. balance is already spendable;
    // escrow/withdrawal columns are separate liability buckets and must not be
    // subtracted from balance a second time. Alias columns are normalized with
    // the same max-not-sum rule used by the customer wallet balance layer.
    let totalLockedEscrow = 0;
    let totalLockedWithdrawal = 0;
    let totalAvailable = 0;

    const assetsResult = await fetchAllSupabaseRows<any>(
      (from, to) => supabaseAdmin
        .from('wallet_assets')
        .select('asset_symbol,balance,locked_balance,reserved_balance,in_escrow,in_withdrawal', { count: 'exact' })
        .range(from, to),
      { pageSize: 1000, maxRows: 20000 }
    );
    if (assetsResult.error || assetsResult.truncated) {
      console.error('[ADMIN_METRICS] Canonical wallet liability read failed or exceeded the safe cap.');
      return NextResponse.json({ success: false, error: 'Wallet liability metrics could not be fully verified.' }, { status: 503 });
    }
    const assets = assetsResult.rows;

    for (const asset of assets) {
      if (String(asset.asset_symbol || '').trim().toUpperCase() !== 'USDT') continue;
      const numericValues = [
        asset.balance,
        asset.locked_balance,
        asset.reserved_balance,
        asset.in_escrow,
        asset.in_withdrawal,
      ];
      if (numericValues.some((value) => value !== null && value !== undefined &&
          (!Number.isFinite(Number(value)) || Number(value) < 0))) {
        console.error('[ADMIN_METRICS] Invalid wallet liability row encountered.');
        return NextResponse.json({ success: false, error: 'Wallet liability reconciliation is required.' }, { status: 503 });
      }
      const normalized = normalizePrimaryWalletAssetBalance(asset);
      totalAvailable += normalized.available;
      totalLockedEscrow += normalized.inEscrow;
      totalLockedWithdrawal += normalized.inWithdrawal;
    }

    // 3. Hot Wallet Reserves & Status (Primary: BSC, Optional: others)
    const hotWallets = [];
    const chainsToCheck = ['BEP20'];
    if (process.env.ETH_RPC_URL || process.env.EVM_RPC_URL) chainsToCheck.push('ERC20');
    if (process.env.TRON_HOT_WALLET_ADDRESS) chainsToCheck.push('TRC20');

    for (const chain of chainsToCheck) {
      const reserve = await getHotWalletOnchainBalance(chain, 'USDT');
      hotWallets.push(reserve);
    }

    // 4. Dispute Statistics
    let openDisputes = 0;
    let resolvedDisputes = 0;
    let totalDisputes = 0;
    const disputesResult = await fetchAllSupabaseRows<any>(
      (from, to) => supabaseAdmin
        .from('disputes')
        .select('id,status', { count: 'exact' })
        .range(from, to),
      { pageSize: 1000, maxRows: 20000 }
    );
    if (disputesResult.error || disputesResult.truncated) {
      console.error('[ADMIN_METRICS] Dispute metrics read failed or exceeded the safe cap.');
      return NextResponse.json({ success: false, error: 'Dispute metrics could not be fully verified.' }, { status: 503 });
    }
    for (const dispute of disputesResult.rows) {
      totalDisputes++;
      if (['OPEN', 'INVESTIGATING', 'IN_REVIEW'].includes(String(dispute.status || '').toUpperCase())) {
        openDisputes++;
      } else {
        resolvedDisputes++;
      }
    }

    // 5. Active Security Alerts Count
    let activeAlertsCount = 0;
    try {
      const { count } = await supabaseAdmin
        .from('system_alerts')
        .select('*', { count: 'exact', head: true })
        .eq('is_resolved', false);
      activeAlertsCount = count || 0;
    } catch (_) {}

    // Log admin read action
    try {
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || '127.0.0.1';
      await supabaseAdmin.from('admin_audit_logs').insert({
        admin_id: auth.adminId || auth.user.id,
        action: 'VIEW_METRICS',
        details: {
          path: '/api/admin/metrics',
          ip_address_hint: ip,
          ip_address_trust: 'forwarded_header_unverified',
        },
      });
    } catch (_) {}

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      metrics: {
        trading: {
          totalVolumeUsdt,
          completedTradesCount,
          unpricedCompletedTradesCount,
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
