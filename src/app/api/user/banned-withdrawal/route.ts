import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized: Session required.' }, { status: 401 });
    }

    const userId = user.id;

    // Verify user is banned
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, is_banned, status, ban_reason, suspension_reason')
      .eq('id', userId)
      .single();

    if (!profile || (!profile.is_banned && profile.status !== 'banned')) {
      return NextResponse.json({ error: 'Only banned accounts can use final withdrawal.' }, { status: 403 });
    }

    const { currency, address, network } = await req.json();

    if (!currency || !address || typeof address !== 'string' || address.trim().length < 8) {
      return NextResponse.json({ error: 'Valid cryptocurrency and destination wallet address are required.' }, { status: 400 });
    }

    // Fetch user wallet for this currency
    const { data: wallet } = await supabaseAdmin
      .from('wallets')
      .select('*')
      .eq('user_id', userId)
      .ilike('currency', currency)
      .maybeSingle();

    const currentBalance = Number(wallet?.balance || 0);

    if (currentBalance <= 0) {
      return NextResponse.json({ error: `No available balance for ${currency} to withdraw.` }, { status: 400 });
    }

    // Per requirement: only MAX coin can be selected per coin (100% of available balance)
    const withdrawalAmount = currentBalance;

    // Deduct standard nominal gas fee if possible, otherwise sweep entire balance
    const gasFee = Math.min(0.0005, withdrawalAmount * 0.01);
    const netAmount = Math.max(0, withdrawalAmount - gasFee);

    // Try RPC first if available in database
    try {
      const { data: rpcData, error: rpcErr } = await supabase.rpc('execute_final_withdrawal', {
        p_user_id: userId,
        p_currency: currency,
        p_network: network || 'Mainnet',
        p_address: address.trim(),
        p_gas_fee: gasFee,
      });

      if (!rpcErr && rpcData) {
        return NextResponse.json({
          success: true,
          status: 'Queued',
          message: `Final withdrawal of full ${currency} balance (${withdrawalAmount}) queued to ${address.trim()}.`,
          data: rpcData
        });
      }
    } catch (rpcEx) {
      console.warn('execute_final_withdrawal RPC call not found or error, proceeding with direct transaction:', rpcEx);
    }

    // Direct transaction fallback:
    // 1. Zero out wallet balance
    const { error: walletUpdateErr } = await supabaseAdmin
      .from('wallets')
      .update({
        balance: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', wallet.id);

    if (walletUpdateErr) {
      return NextResponse.json({ error: 'Failed to deduct wallet balance.' }, { status: 500 });
    }

    // 2. Insert record into withdrawals / transactions table if available
    try {
      await supabaseAdmin.from('withdrawals').insert({
        user_id: userId,
        amount: netAmount,
        currency: currency.toUpperCase(),
        crypto: currency.toUpperCase(),
        destination_address: address.trim(),
        network: network || 'Mainnet',
        status: 'PENDING',
        fee: gasFee,
        is_final_banned_withdrawal: true,
        created_at: new Date().toISOString(),
      });
    } catch (insertErr) {
      console.warn('Withdrawal table insert notice:', insertErr);
    }

    return NextResponse.json({
      success: true,
      status: 'Queued',
      amount: withdrawalAmount,
      currency,
      message: `Final one-time withdrawal of ${withdrawalAmount} ${currency} has been queued successfully.`
    });
  } catch (err: any) {
    console.error('Final withdrawal fatal error:', err);
    return NextResponse.json({ error: err.message || 'Withdrawal processing failed.' }, { status: 500 });
  }
}
