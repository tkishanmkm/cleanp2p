import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { reconcileLedgerVsChain } from '@/jobs/reconciliationWorker';
import { verifyServerAdmin } from '@/lib/server-admin-auth';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export async function GET(req: NextRequest) {
  try {
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized) {
      return (
        auth.response ||
        NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
      );
    }

    // 1. Fetch latest system reconciliation report
    let { data: reconciliation } = await supabaseAdmin
      .from('system_reconciliations')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // If no reconciliation snapshot exists yet, generate initial one
    if (!reconciliation) {
      try {
        const report = await reconcileLedgerVsChain('USDT');
        reconciliation = {
          asset_symbol: report.assetSymbol,
          db_liability: report.totalDbLiability,
          onchain_balance: report.onChainHotWalletBalance,
          discrepancy: report.discrepancy,
          is_balanced: report.isBalanced,
          gas_snapshot: report.gasStatuses,
          created_at: new Date().toISOString(),
        } as any;
      } catch (e: any) {
        console.warn('Initial reconciliation run warning:', e.message);
      }
    }

    // 2. Fetch pending withdrawals awaiting admin manual sign-off
    const { data: pendingApprovals } = await supabaseAdmin
      .from('onchain_withdrawals')
      .select('id, user_id, network, to_address, amount, fee, asset_symbol, created_at')
      .eq('status', 'NEEDS_APPROVAL')
      .order('created_at', { ascending: true });

    // 3. Fetch 24h withdrawal statistics
    const { data: stats } = await supabaseAdmin
      .from('onchain_withdrawals')
      .select('amount, status')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    const total24hVolume = (stats || [])
      .filter((s) => s.status === 'CONFIRMED' || s.status === 'BROADCASTED' || s.status === 'COMPLETED')
      .reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);

    return NextResponse.json({
      success: true,
      data: {
        reconciliation,
        pendingApprovals: (pendingApprovals || []).map((item: any) => ({
          ...item,
          amount: parseFloat(item.amount) || 0,
          fee: parseFloat(item.fee) || 0,
        })),
        stats: {
          total24hVolume,
          pendingApprovalCount: (pendingApprovals || []).length,
        },
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
