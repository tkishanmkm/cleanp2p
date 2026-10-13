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

const TX_HASH_RE = /^[0-9a-fA-F]{64}$/;
const BTC_ADDRESS_MAX_LENGTH = 100;

type BlockCypherOutput = {
  addresses?: unknown;
  value?: unknown;
  n?: unknown;
};

export async function POST(req: Request) {
  const authResult = verifyWebhookSecret(req);
  if (authResult === 'missing-config') {
    return NextResponse.json({ error: 'Webhook authentication is not configured' }, { status: 503 });
  }
  if (authResult !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized webhook request' }, { status: 401 });
  }

  let payload: {
    hash?: unknown;
    outputs?: unknown;
    confirmations?: unknown;
    block_height?: unknown;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const txHash = typeof payload.hash === 'string' ? payload.hash.trim() : '';
  if (!TX_HASH_RE.test(txHash)) {
    return NextResponse.json({ error: 'Invalid transaction hash' }, { status: 400 });
  }
  if (!Array.isArray(payload.outputs) || payload.outputs.length === 0) {
    return NextResponse.json({ error: 'Invalid transaction outputs' }, { status: 400 });
  }

  const confirmations = payload.confirmations;
  if (!Number.isSafeInteger(confirmations) || (confirmations as number) < 0) {
    return NextResponse.json({ error: 'Invalid confirmations value' }, { status: 400 });
  }

  let blockHeight: number | null = null;
  if (payload.block_height !== undefined && payload.block_height !== null) {
    if (!Number.isSafeInteger(payload.block_height) || (payload.block_height as number) < 0) {
      return NextResponse.json({ error: 'Invalid block height' }, { status: 400 });
    }
    blockHeight = payload.block_height as number;
  }

  const outputs = payload.outputs as BlockCypherOutput[];
  const validatedOutputs: Array<{ address: string; satoshis: number; outputIndex: number }> = [];
  for (const output of outputs) {
    if (!output || typeof output !== 'object') {
      return NextResponse.json({ error: 'Invalid transaction output' }, { status: 400 });
    }
    if (
      !Array.isArray(output.addresses) ||
      typeof output.addresses[0] !== 'string' ||
      output.addresses[0].length === 0 ||
      output.addresses[0].length > BTC_ADDRESS_MAX_LENGTH ||
      output.addresses[0].trim() !== output.addresses[0]
    ) {
      return NextResponse.json({ error: 'Invalid output address' }, { status: 400 });
    }
    if (!Number.isSafeInteger(output.value) || (output.value as number) <= 0) {
      return NextResponse.json({ error: 'Invalid output value' }, { status: 400 });
    }
    if (!Number.isSafeInteger(output.n) || (output.n as number) < 0) {
      return NextResponse.json({ error: 'Invalid output index' }, { status: 400 });
    }
    validatedOutputs.push({
      address: output.addresses[0],
      satoshis: output.value as number,
      outputIndex: output.n as number,
    });
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const results: Array<{ txHash: string; outputIndex: number; status: 'processed' | 'failed'; error?: string; result?: unknown }> = [];

  for (const output of validatedOutputs) {
    const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('process_deposit_atomic', {
      p_destination_address: output.address,
      p_asset_symbol: 'BTC',
      p_network_code: 'BTC',
      p_amount: output.satoshis / 1e8,
      p_tx_hash: txHash,
      p_output_index: output.outputIndex,
      p_block_number: blockHeight,
      p_from_address: null,
      p_token_contract: null,
      // Provider-supplied confirmations are only a hint, not independent chain verification.
      p_confirmations: confirmations as number,
      p_provider: 'blockcypher_webhook',
    });

    if (rpcErr) {
      console.error(`[Blockcypher Webhook] RPC error for ${txHash}:${output.outputIndex}:`, rpcErr.message);
      results.push({ txHash, outputIndex: output.outputIndex, status: 'failed', error: 'Deposit processing failed' });
    } else {
      results.push({ txHash, outputIndex: output.outputIndex, status: 'processed', result: rpcData });
    }
  }

  const failed = results.filter((result) => result.status === 'failed').length;
  if (failed > 0) {
    // Avoid acknowledging partial failures as a successful provider delivery.
    return NextResponse.json(
      { status: failed === results.length ? 'failed' : 'partial_failure', processed: results.length - failed, failed },
      { status: 500 }
    );
  }

  return NextResponse.json({ status: 'success', processed: results.length, results }, { status: 200 });
}
