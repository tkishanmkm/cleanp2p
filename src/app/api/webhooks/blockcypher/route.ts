import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export async function POST(req: Request) {
  const payload = await req.json().catch(() => ({}));
  const { hash: txHash, outputs, confirmations = 0, block_height } = payload;

  if (!txHash || !Array.isArray(outputs)) {
    return NextResponse.json({ message: 'Invalid payload' }, { status: 400 });
  }

  // Process only transactions with valid hash
  const supabaseAdmin = getSupabaseAdminClient();
  const results = [];

  for (const output of outputs) {
    const toAddress = output.addresses?.[0];
    const valueBtc = (output.value || 0) / 1e8; // Convert Satoshis to BTC
    const outputIndex = typeof output.n === 'number' ? output.n : 0;

    if (!toAddress || valueBtc <= 0) continue;

    // Call canonical atomic deposit RPC
    const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('process_deposit_atomic', {
      p_destination_address: toAddress,
      p_asset_symbol: 'BTC',
      p_network_code: 'BTC',
      p_amount: valueBtc,
      p_tx_hash: txHash,
      p_output_index: outputIndex,
      p_block_number: block_height || null,
      p_from_address: null,
      p_token_contract: null,
      p_confirmations: confirmations || 0,
      p_provider: 'blockcypher_webhook',
    });

    if (rpcErr) {
      console.error(`[Blockcypher Webhook] RPC error for ${txHash}:${outputIndex}:`, rpcErr.message);
      results.push({ txHash, outputIndex, error: rpcErr.message });
    } else {
      results.push({ txHash, outputIndex, result: rpcData });
    }
  }

  return NextResponse.json({ status: 'success', processed: results.length, results }, { status: 200 });
}
