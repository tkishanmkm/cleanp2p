import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

/**
 * Reject unauthenticated provider callbacks before they can reach the privileged deposit RPC.
 * Configure a provider-compatible signed gateway/header before enabling this endpoint.
 */
function verifyWebhookSecret(req: Request): 'ok' | 'missing-config' | 'unauthorized' {
  const secret = process.env.BLOCKCYPHER_WEBHOOK_SECRET
    || process.env.BLOCKCHAIN_WEBHOOK_SECRET;
  if (!secret || !secret.trim()) return 'missing-config';

  const authorization = req.headers.get('authorization') || '';
  const bearer = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
  const supplied = req.headers.get('x-webhook-secret') || bearer;
  if (!supplied) return 'unauthorized';

  const expectedBytes = Buffer.from(secret.trim(), 'utf8');
  const suppliedBytes = Buffer.from(supplied, 'utf8');
  if (expectedBytes.length !== suppliedBytes.length) return 'unauthorized';
  return crypto.timingSafeEqual(expectedBytes, suppliedBytes) ? 'ok' : 'unauthorized';
}

export async function POST(req: Request) {

  const authResult = verifyWebhookSecret(req);
  if (authResult === 'missing-config') {
    return NextResponse.json({ error: 'Webhook authentication is not configured' }, { status: 503 });
  }
  if (authResult !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized webhook request' }, { status: 401 });
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

  return NextResponse.json({ status: 'success', processed: results.length, results }, { status: 200 });
}
