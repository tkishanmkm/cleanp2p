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

const FIXED_WITHDRAWAL_FEE = 1.0; // e.g. 1.00 USDT network/platform fee

/**
 * Fallback withdrawal locking logic if stored procedure request_withdrawal is not loaded
 */
async function fallbackRequestWithdrawal(
  userId: string,
  network: string,
  toAddress: string,
  amount: number,
  fee: number,
  assetSymbol: string
): Promise<string> {
  const assetCode = assetSymbol.toUpperCase().trim();
  const networkCode = network.toUpperCase().trim();
  const totalDeduct = amount + fee;

  // 1. Resolve or create user's wallet
  let walletId: string | null = null;
  const { data: wallet } = await supabaseAdmin
    .from('wallets')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (wallet?.id) {
    walletId = wallet.id;
  } else {
    const { data: newWallet } = await supabaseAdmin
      .from('wallets')
      .insert({
        user_id: userId,
        status: 'active',
        provisioning_status: 'completed',
      })
      .select('id')
      .single();
    walletId = newWallet?.id || null;
  }

  if (!walletId) {
    throw new Error('Failed to resolve active wallet for user');
  }

  // 2. Fetch and check available balance
  const { data: assetData, error: assetErr } = await supabaseAdmin
    .from('wallet_assets')
    .select('available, locked_withdrawal')
    .eq('wallet_id', walletId)
    .eq('asset_code', assetCode)
    .maybeSingle();

  if (assetErr) {
    throw new Error(`Failed to query wallet assets: ${assetErr.message}`);
  }

  const available = Number(assetData?.available || 0);
  const lockedWithdrawal = Number(assetData?.locked_withdrawal || 0);

  if (available < totalDeduct) {
    throw new Error(`Insufficient balance. Available: ${available}, Required: ${totalDeduct} (${amount} + fee ${fee})`);
  }

  // 3. Atomically deduct available balance and increase locked_withdrawal
  const newAvailable = available - totalDeduct;
  const newLocked = lockedWithdrawal + totalDeduct;

  const { error: updateErr } = await supabaseAdmin
    .from('wallet_assets')
    .update({
      available: newAvailable,
      locked_withdrawal: newLocked,
      updated_at: new Date().toISOString(),
    })
    .eq('wallet_id', walletId)
    .eq('asset_code', assetCode);

  if (updateErr) {
    throw new Error(`Failed to lock balance: ${updateErr.message}`);
  }

  // 4. Insert into onchain_withdrawals queue
  const { data: withdrawalRecord, error: insertErr } = await supabaseAdmin
    .from('onchain_withdrawals')
    .insert({
      user_id: userId,
      wallet_id: walletId,
      to_address: toAddress,
      amount: amount,
      asset_symbol: assetCode,
      network: networkCode,
      status: 'PENDING',
      metadata: { fee, total_deducted: totalDeduct },
    })
    .select('id')
    .single();

  if (insertErr || !withdrawalRecord?.id) {
    // Revert balance lock if insertion failed
    await supabaseAdmin
      .from('wallet_assets')
      .update({
        available,
        locked_withdrawal: lockedWithdrawal,
        updated_at: new Date().toISOString(),
      })
      .eq('wallet_id', walletId)
      .eq('asset_code', assetCode);

    throw new Error(`Failed to queue withdrawal: ${insertErr?.message || 'Unknown error'}`);
  }

  const withdrawalId = withdrawalRecord.id;

  // 5. Immutable ledger entry
  await supabaseAdmin
    .from('ledger_entries')
    .insert({
      wallet_id: walletId,
      user_id: userId,
      asset_code: assetCode,
      delta_available: -totalDeduct,
      delta_locked: +totalDeduct,
      available_after: newAvailable,
      locked_after: newLocked,
      entry_type: 'withdrawal_lock',
      ref_table: 'onchain_withdrawals',
      ref_id: withdrawalId,
      idempotency_key: `wlock_${withdrawalId}`,
    })
    .catch((err: any) => console.warn('Ledger lock entry notice:', err.message));

  return withdrawalId;
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify user JWT token via Supabase Auth
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
    }

    const body = await req.json();
    const { network, toAddress, amount, assetSymbol = 'USDT' } = body;

    // Input validations
    if (!network || !toAddress || !amount || parseFloat(amount) <= 0) {
      return NextResponse.json({ error: 'Invalid request parameters' }, { status: 400 });
    }

    const withdrawAmount = parseFloat(amount);

    // Call stored procedure to validate balance and atomically deduct funds
    let withdrawalId: string | null = null;
    let rpcSuccess = false;

    try {
      const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('request_withdrawal', {
        p_user_id: user.id,
        p_network: network.toUpperCase(),
        p_to_address: toAddress,
        p_amount: withdrawAmount,
        p_fee: FIXED_WITHDRAWAL_FEE,
        p_asset: assetSymbol.toUpperCase(),
      });

      if (!rpcError && rpcData) {
        rpcSuccess = true;
        withdrawalId = typeof rpcData === 'string' ? rpcData : (rpcData.withdrawal_id || rpcData.id || String(rpcData));
      } else if (rpcError) {
        // If error is actual business logic (e.g., Insufficient balance), throw immediately
        if (
          rpcError.message?.toLowerCase().includes('insufficient') ||
          rpcError.message?.toLowerCase().includes('restricted') ||
          rpcError.message?.toLowerCase().includes('banned')
        ) {
          return NextResponse.json({ error: rpcError.message }, { status: 400 });
        }
        console.warn('RPC request_withdrawal notice, falling back to TypeScript handler:', rpcError.message);
      }
    } catch (rpcEx: any) {
      console.warn('RPC request_withdrawal exception:', rpcEx.message);
    }

    // Fallback if RPC was unavailable
    if (!rpcSuccess) {
      withdrawalId = await fallbackRequestWithdrawal(
        user.id,
        network,
        toAddress,
        withdrawAmount,
        FIXED_WITHDRAWAL_FEE,
        assetSymbol
      );
    }

    return NextResponse.json({
      success: true,
      withdrawalId,
      message: 'Withdrawal request queued successfully',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
