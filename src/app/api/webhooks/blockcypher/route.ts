import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export async function POST(req: Request) {
  const configuredToken = process.env.BLOCKCYPHER_WEBHOOK_TOKEN;
  const suppliedToken = new URL(req.url).searchParams.get('token') ?? '';

  // BlockCypher supports a secret query parameter on the configured callback URL.
  // Fail closed until the same token is configured in both places.
  if (!configuredToken) {
    console.error('[BlockCypher Webhook] BLOCKCYPHER_WEBHOOK_TOKEN is not configured.');
    return NextResponse.json({ message: 'Webhook verification is not configured.' }, { status: 503 });
  }
  const expectedTokenBytes = Buffer.from(configuredToken, 'utf8');
  const suppliedTokenBytes = Buffer.from(suppliedToken, 'utf8');
  if (
    expectedTokenBytes.length !== suppliedTokenBytes.length ||
    !crypto.timingSafeEqual(expectedTokenBytes, suppliedTokenBytes)
  ) {
    return NextResponse.json({ message: 'Unauthorized webhook.' }, { status: 401 });
  }

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

  const hasErrors = results.some((result: { error?: string }) => Boolean(result.error));
  return NextResponse.json(
    { status: hasErrors ? 'partial' : 'success', processed: results.length, results },
    { status: hasErrors ? 500 : 200 }
  );
}
