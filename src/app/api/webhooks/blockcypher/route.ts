import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';
import { verifyUtxoDepositOutput } from '@/lib/blockchain/verify-utxo-deposit';
import { readBoundedRequestBody } from '@/lib/security/read-bounded-request-body';
import { parseDepositRpcResult } from '@/lib/deposit-rpc-result';

export const dynamic = 'force-dynamic';

const MAX_BLOCKCYPHER_WEBHOOK_BYTES = 2 * 1024 * 1024;
const MAX_BLOCKCYPHER_OUTPUTS = 100;

export async function POST(req: Request) {
  // Fail closed: deposit-credit callbacks must never put a shared secret in
  // the URL, where proxies, analytics, and request logs can capture it.
  // Use a trusted webhook gateway that injects x-webhook-secret/x-ingest-secret.
  // Direct query-string secret authentication is deliberately disabled.
  const auth = verifyWorkerAuth(req, {
    allowedSecrets: [process.env.BLOCKCHAIN_WEBHOOK_SECRET, process.env.CHAIN_INGEST_SECRET],
    customHeaderNames: ['x-webhook-secret', 'x-ingest-secret'],
    checkQueryParam: false,
  });
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let rawBody: string | null;
  try {
    rawBody = await readBoundedRequestBody(req, MAX_BLOCKCYPHER_WEBHOOK_BYTES);
  } catch {
    return NextResponse.json({ error: 'Invalid UTF-8 webhook body.' }, { status: 400 });
  }
  if (rawBody === null) {
    return NextResponse.json({ error: 'Webhook payload is too large.' }, { status: 413 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ message: 'Invalid JSON payload' }, { status: 400 });
  }

  const txHash = payload?.hash;
  const outputs = payload?.outputs;
  if (typeof txHash !== 'string' || !Array.isArray(outputs)) {
    return NextResponse.json({ message: 'Invalid payload' }, { status: 400 });
  }
  if (outputs.length > MAX_BLOCKCYPHER_OUTPUTS) {
    return NextResponse.json({ error: 'Too many transaction outputs in one webhook payload.' }, { status: 413 });
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const results = [];
  let registrationFailures = 0;
  for (const output of outputs) {
    const toAddress = output?.addresses?.[0];
    const outputIndex = output?.n;
    if (typeof toAddress !== 'string' || !Number.isSafeInteger(outputIndex) || outputIndex < 0) continue;

    try {
      // BlockCypher payload fields are notifications only. Derive output amount,
      // block height and confirmations from the BTC chain explorer before registering.
      const verified = await verifyUtxoDepositOutput('BTC', txHash, toAddress, outputIndex);
      if (!verified) {
        results.push({ txHash, outputIndex, status: 'pending_or_unverified' });
        continue;
      }
      const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('register_pending_deposit', {
        p_destination_address: verified.address,
        p_asset_symbol: 'BTC',
        p_network_code: 'BTC',
        p_amount: verified.amount,
        p_tx_hash: verified.txid,
        p_output_index: verified.outputIndex,
        p_block_number: verified.blockHeight,
        p_from_address: null,
        p_token_contract: null,
        p_confirmations: 0,
        p_provider: 'blockcypher_webhook_pending',
      });
      if (rpcErr) {
        console.error('[Blockcypher Webhook] Pending registration RPC failed:', {
          code: rpcErr.code || 'UNKNOWN',
          outputIndex,
        });
        registrationFailures++;
        results.push({ txHash, outputIndex, status: 'registration_error', error: 'deposit_processing_failed' });
      } else {
        const parsedResult = parseDepositRpcResult(rpcData);
        if (!parsedResult.success) {
          registrationFailures++;
          results.push({
            txHash,
            outputIndex,
            status: 'registration_error',
            error: parsedResult.code || parsedResult.message || 'deposit_processing_rejected',
          });
        } else {
          results.push({
            txHash,
            outputIndex,
            status: parsedResult.alreadyCredited ? 'already_processed' : 'pending',
            result: parsedResult.raw,
          });
        }
      }
    } catch {
      console.error('[Blockcypher Webhook] Independent chain verification failed.', { outputIndex });
      results.push({ txHash, outputIndex, status: 'verification_unavailable' });
    }
  }
  return NextResponse.json(
    { status: registrationFailures > 0 ? 'retry' : 'accepted', success: registrationFailures === 0, processed: results.length, results },
    { status: registrationFailures > 0 ? 503 : 200 }
  );
}
