import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifySharedWebhookSecret } from '@/lib/webhooks/auth';

export async function POST(req: Request) {
  const secret = process.env.BLOCKCYPHER_WEBHOOK_SECRET || process.env.BLOCKCHAIN_WEBHOOK_SECRET;
  if (!secret?.trim()) {
    return NextResponse.json({ error: 'Webhook authentication is not configured' }, { status: 503 });
  }
  if (!verifySharedWebhookSecret(req, secret)) {
    return NextResponse.json({ error: 'Unauthorized webhook' }, { status: 401 });
  }

  const payload = await req.json().catch(() => ({}));
  const { hash: txHash, outputs, confirmations = 0, block_height } = payload;

  if (!txHash || !Array.isArray(outputs)) {
    return NextResponse.json({ message: 'Invalid payload' }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const results = [];

  for (const output of outputs) {
    const toAddress = output.addresses?.[0];
    const valueSatoshis = Number(output.value);
    const outputIndex = output.n;

    // Missing/invalid output identity must not collapse to output zero.
    if (!toAddress || !Number.isSafeInteger(valueSatoshis) || valueSatoshis <= 0 ||
        !Number.isInteger(outputIndex) || outputIndex < 0) continue;

    const valueBtc = valueSatoshis / 1e8;
    const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('process_deposit_atomic', {
      p_destination_address: toAddress,
      p_asset_symbol: 'BTC',
      p_network_code: 'BTC',
      p_amount: valueBtc,
      p_tx_hash: txHash,
      p_output_index: outputIndex,
      p_block_number: Number.isInteger(block_height) && block_height > 0 ? block_height : null,
      p_from_address: null,
      p_token_contract: null,
      // Provider-reported confirmations are untrusted until independently verified.
      p_confirmations: Number.isInteger(confirmations) && confirmations >= 0 ? confirmations : 0,
      p_provider: 'blockcypher_webhook',
    });

    if (rpcErr) {
      console.error('[Blockcypher Webhook] Canonical deposit RPC failed');
      results.push({ txHash, outputIndex, error: 'Deposit processing failed' });
    } else {
      results.push({ txHash, outputIndex, result: rpcData });
    }
  }

  const failed = results.some((result: any) => result.error);
  return NextResponse.json({ status: failed ? 'partial_failure' : 'processed', processed: results.length, results }, { status: failed ? 500 : 200 });
}
