import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export async function POST(req: Request) {
  const payload = await req.json();
  const { hash: txHash, outputs, confirmations, block_height } = payload;

  // Process only confirmed transactions (e.g., min 1 confirmation)
  if (confirmations < 1) {
    return NextResponse.json({ message: 'Unconfirmed transaction ignored' }, { status: 200 });
  }

  const supabaseAdmin = getSupabaseAdminClient();

  for (const output of outputs || []) {
    const toAddress = output.addresses?.[0];
    const valueBtc = (output.value || 0) / 1e8; // Convert Satoshis to BTC

    if (!toAddress || valueBtc <= 0) continue;

    const { data: addressRecord } = await supabaseAdmin
      .from('user_deposit_addresses')
      .select('user_id')
      .eq('address', toAddress)
      .single();

    if (!addressRecord) continue;

    const userId = addressRecord.user_id;

    // Insert transaction record
    const { error: txError } = await supabaseAdmin
      .from('wallet_transactions')
      .insert({
        user_id: userId,
        tx_hash: `${txHash}:${output.n}`, // Combine hash + index for output uniqueness
        type: 'deposit',
        network: 'bitcoin',
        asset_symbol: 'BTC',
        amount: valueBtc,
        to_address: toAddress,
        status: 'confirmed',
        block_number: block_height
      });

    if (txError && txError.code === '23505') continue;

    // Credit balance
    await supabaseAdmin.rpc('credit_user_balance', {
      target_user_id: userId,
      target_asset: 'BTC',
      target_network: 'bitcoin',
      credit_amount: valueBtc
    });
  }

  return NextResponse.json({ status: 'success' }, { status: 200 });
}
