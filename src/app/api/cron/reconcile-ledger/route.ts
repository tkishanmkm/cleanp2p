import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Timing-safe authentication against CRON_SECRET or WORKER_SECRET
 */
function verifyCronAuth(authHeader: string | null): boolean {
  if (!authHeader) return false;

  const validSecrets = [
    process.env.CRON_SECRET,
    process.env.WORKER_SECRET,
  ].filter((s): s is string => Boolean(s && s.trim().length > 0));

  if (validSecrets.length === 0) {
    // If no secret configured in development, check for fallback Bearer token
    return process.env.NODE_ENV === 'development';
  }

  const headerBuf = Buffer.from(authHeader);

  for (const secret of validSecrets) {
    const expected = `Bearer ${secret}`;
    const expectedBuf = Buffer.from(expected);

    if (headerBuf.length === expectedBuf.length) {
      if (crypto.timingSafeEqual(headerBuf, expectedBuf)) {
        return true;
      }
    }
  }

  return false;
}

export interface ReconcileResult {
  userId: string;
  assetSymbol: string;
  walletBalance: number;
  calculatedBalance: number;
  discrepancy: number;
  isDiscrepancy: boolean;
  frozen: boolean;
  breakdown: {
    totalDeposits: number;
    totalWithdrawalsWithFees: number;
    totalTransfersReceived: number;
    totalTransfersSentWithFees: number;
  };
}

async function performReconciliation() {
  const admin = getSupabaseAdminClient();

  // 1. Fetch all user wallet records
  const { data: userWallets, error: walletsErr } = await admin
    .from('user_wallets')
    .select('id, user_id, asset_symbol, balance, available_balance, locked_balance, status, is_frozen');

  if (walletsErr) {
    console.error('[Reconcile Ledger] Error fetching user_wallets:', walletsErr);
    throw new Error(`Failed to query user_wallets: ${walletsErr.message}`);
  }

  const passedAccounts: ReconcileResult[] = [];
  const flaggedAccounts: ReconcileResult[] = [];

  const validDepositStatuses = ['confirmed', 'CONFIRMED', 'completed', 'COMPLETED', 'credited', 'CREDITED'];
  const validWithdrawalStatuses = ['confirmed', 'CONFIRMED', 'pending', 'PENDING', 'processing', 'PROCESSING', 'queued', 'QUEUED', 'completed', 'COMPLETED'];
  const validTransferStatuses = ['confirmed', 'CONFIRMED', 'completed', 'COMPLETED'];

  // Process wallets
  for (const wallet of userWallets || []) {
    const userId = wallet.user_id;
    const asset = (wallet.asset_symbol || '').toUpperCase().trim();

    if (!userId || !asset) continue;

    const currentWalletBalance = Number(
      wallet.balance ?? (Number(wallet.available_balance || 0) + Number(wallet.locked_balance || 0))
    );

    // a. Deposits Sum
    const { data: deposits } = await admin
      .from('onchain_deposits')
      .select('amount, status')
      .eq('user_id', userId)
      .ilike('asset_symbol', asset)
      .in('status', validDepositStatuses);

    const totalDeposits = (deposits || []).reduce((sum, d) => sum + Number(d.amount || 0), 0);

    // b. Withdrawals Sum (amount + gas_fee)
    const { data: withdrawals } = await admin
      .from('hot_wallet_withdrawals')
      .select('amount, gas_fee, status')
      .eq('user_id', userId)
      .ilike('asset_symbol', asset)
      .in('status', validWithdrawalStatuses);

    const totalWithdrawalsWithFees = (withdrawals || []).reduce(
      (sum, w) => sum + Number(w.amount || 0) + Number(w.gas_fee || 0),
      0
    );

    // c. Sent Transfers Sum (amount + fee_amount)
    const { data: sentTransfers } = await admin
      .from('transfers')
      .select('amount, fee_amount, status, crypto, asset_symbol')
      .eq('sender_id', userId)
      .or(`crypto.ilike.${asset},asset_symbol.ilike.${asset}`)
      .in('status', validTransferStatuses);

    const totalTransfersSentWithFees = (sentTransfers || []).reduce(
      (sum, t) => sum + Number(t.amount || 0) + Number(t.fee_amount || 0),
      0
    );

    // d. Received Transfers Sum (amount)
    const { data: recvTransfers } = await admin
      .from('transfers')
      .select('amount, status, crypto, asset_symbol')
      .eq('recipient_id', userId)
      .or(`crypto.ilike.${asset},asset_symbol.ilike.${asset}`)
      .in('status', validTransferStatuses);

    const totalTransfersReceived = (recvTransfers || []).reduce(
      (sum, t) => sum + Number(t.amount || 0),
      0
    );

    // e. Formula: Calculated Balance = Deposits - Withdrawals + Transfers Received - Transfers Sent
    const calculatedBalance = Number(
      (totalDeposits - totalWithdrawalsWithFees + totalTransfersReceived - totalTransfersSentWithFees).toFixed(8)
    );

    const discrepancy = Number(Math.abs(currentWalletBalance - calculatedBalance).toFixed(8));
    const isDiscrepancy = discrepancy > 0.00000001;

    const record: ReconcileResult = {
      userId,
      assetSymbol: asset,
      walletBalance: Number(currentWalletBalance.toFixed(8)),
      calculatedBalance,
      discrepancy,
      isDiscrepancy,
      frozen: false,
      breakdown: {
        totalDeposits: Number(totalDeposits.toFixed(8)),
        totalWithdrawalsWithFees: Number(totalWithdrawalsWithFees.toFixed(8)),
        totalTransfersReceived: Number(totalTransfersReceived.toFixed(8)),
        totalTransfersSentWithFees: Number(totalTransfersSentWithFees.toFixed(8)),
      },
    };

    if (isDiscrepancy) {
      console.error(
        `[LEDGER DISCREPANCY DETECTED] User: ${userId} | Asset: ${asset} | Wallet: ${currentWalletBalance} | Calc: ${calculatedBalance} | Diff: ${discrepancy}`
      );

      // Freeze user's wallet
      await admin
        .from('user_wallets')
        .update({
          status: 'frozen',
          is_frozen: true,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('asset_symbol', asset);

      // Record audit log
      await admin
        .from('audit_logs')
        .insert({
          action: 'LEDGER_DISCREPANCY_AUTO_FREEZE',
          user_id: userId,
          details: {
            asset,
            wallet_balance: currentWalletBalance,
            calculated_balance: calculatedBalance,
            discrepancy,
            breakdown: record.breakdown,
          },
          created_at: new Date().toISOString(),
        })
        .catch((e: any) => console.warn('Audit log insert notice:', e.message));

      record.frozen = true;
      flaggedAccounts.push(record);
    } else {
      passedAccounts.push(record);
    }
  }

  return {
    totalAccountsChecked: (userWallets || []).length,
    passedCount: passedAccounts.length,
    flaggedCount: flaggedAccounts.length,
    passedAccounts,
    flaggedAccounts,
  };
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');

    if (!verifyCronAuth(authHeader)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[Cron Reconcile-Ledger] Starting nightly balance reconciliation...');
    const result = await performReconciliation();

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        total_accounts_checked: result.totalAccountsChecked,
        passed_count: result.passedCount,
        flagged_count: result.flaggedCount,
      },
      flagged_accounts: result.flaggedAccounts,
      passed_accounts: result.passedAccounts,
    }, { status: 200 });
  } catch (err: any) {
    console.error('[Cron Reconcile-Ledger Error]:', err);
    return NextResponse.json({ error: err.message || 'Internal server error during ledger reconciliation' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  // Support GET triggers from cloud cron schedules with same auth
  return POST(req);
}
