import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

/**
 * Fallback refund processor if process_failed_withdrawal RPC is not yet in Postgres
 */
async function fallbackProcessFailedWithdrawal(withdrawalId: string, reason: string) {
  // 1. Fetch onchain_withdrawal record
  const { data: withdrawal, error: fetchErr } = await supabaseAdmin
    .from('onchain_withdrawals')
    .select('*')
    .eq('id', withdrawalId)
    .single();

  if (fetchErr || !withdrawal) {
    throw new Error(`Withdrawal not found: ${fetchErr?.message || withdrawalId}`);
  }

  if (withdrawal.status === 'FAILED') {
    return { success: true, message: 'Already marked as failed' };
  }

  if (withdrawal.status === 'CONFIRMED' || withdrawal.status === 'COMPLETED') {
    throw new Error(`Cannot refund completed withdrawal: ${withdrawalId}`);
  }

  const fee = Number(withdrawal.metadata?.fee || 0);
  const totalRefund = Number(withdrawal.metadata?.total_deducted || (Number(withdrawal.amount) + fee));

  // 2. Fetch current wallet asset balances
  const { data: assetData } = await supabaseAdmin
    .from('wallet_assets')
    .select('available, locked_withdrawal')
    .eq('wallet_id', withdrawal.wallet_id)
    .eq('asset_code', withdrawal.asset_symbol)
    .maybeSingle();

  const currentAvailable = Number(assetData?.available || 0);
  const currentLocked = Number(assetData?.locked_withdrawal || 0);
  const newAvailable = currentAvailable + totalRefund;
  const newLocked = Math.max(0, currentLocked - totalRefund);

  // 3. Credit available balance and decrement locked_withdrawal
  await supabaseAdmin
    .from('wallet_assets')
    .update({
      available: newAvailable,
      locked_withdrawal: newLocked,
      updated_at: new Date().toISOString(),
    })
    .eq('wallet_id', withdrawal.wallet_id)
    .eq('asset_code', withdrawal.asset_symbol);

  // 4. Update onchain_withdrawals status
  await supabaseAdmin
    .from('onchain_withdrawals')
    .update({
      status: 'FAILED',
      error_message: reason || 'Worker broadcast failure',
      updated_at: new Date().toISOString(),
    })
    .eq('id', withdrawalId);

  // 5. Update platform withdrawals table if it exists
  await supabaseAdmin
    .from('withdrawals')
    .update({
      status: 'failed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', withdrawalId)
    .catch(() => null);

  // 6. Write refund ledger entry
  await supabaseAdmin
    .from('ledger_entries')
    .insert({
      wallet_id: withdrawal.wallet_id,
      user_id: withdrawal.user_id,
      asset_code: withdrawal.asset_symbol,
      delta_available: +totalRefund,
      delta_locked: -totalRefund,
      available_after: newAvailable,
      locked_after: newLocked,
      entry_type: 'withdrawal_refund',
      ref_table: 'onchain_withdrawals',
      ref_id: withdrawalId,
      idempotency_key: `wrefund_${withdrawalId}`,
    })
    .catch((err: any) => console.warn('Ledger refund entry notice:', err.message));

  return { success: true };
}

export async function POST(req: Request) {
  const expectedSecret =
    process.env.WORKER_SECRET?.trim() ||
    process.env.WITHDRAWAL_WORKER_SECRET?.trim() ||
    process.env.NEXT_PUBLIC_WITHDRAWAL_WORKER_SECRET?.trim();

  const secret =
    req.headers.get('x-worker-secret') ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();

  if (expectedSecret && secret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized worker' }, { status: 401 });
  }

  try {
    const { withdrawalId, reason } = await req.json();

    if (!withdrawalId) {
      return NextResponse.json({ error: 'Missing withdrawalId' }, { status: 400 });
    }

    let rpcSuccess = false;

    try {
      const { error: rpcError } = await supabaseAdmin.rpc('process_failed_withdrawal', {
        p_withdrawal_id: withdrawalId,
        p_error_reason: reason || 'Worker broadcast failure',
      });

      if (!rpcError) {
        rpcSuccess = true;
      } else {
        console.warn('RPC process_failed_withdrawal notice, falling back to TypeScript handler:', rpcError.message);
      }
    } catch (rpcEx: any) {
      console.warn('RPC process_failed_withdrawal exception:', rpcEx.message);
    }

    if (!rpcSuccess) {
      await fallbackProcessFailedWithdrawal(withdrawalId, reason || 'Worker broadcast failure');
    }

    return NextResponse.json({ success: true, message: 'Withdrawal refunded successfully' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
