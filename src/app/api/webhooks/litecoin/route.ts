import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';
import { verifyUtxoDepositOutput } from '@/lib/blockchain/verify-utxo-deposit';
import { readBoundedRequestBody } from '@/lib/security/read-bounded-request-body';

export const dynamic = 'force-dynamic';

const MAX_LITECOIN_WEBHOOK_BYTES = 2 * 1024 * 1024;

export async function POST(req: NextRequest) {
  // Fail closed: this endpoint registers deposit candidates, so it must be authenticated.
  const auth = verifyWorkerAuth(req, {
    allowedSecrets: [process.env.BLOCKCHAIN_WEBHOOK_SECRET, process.env.CHAIN_INGEST_SECRET],
    customHeaderNames: ['x-webhook-secret', 'x-ingest-secret'],
    checkQueryParam: false,
  });
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    let rawBody: string | null;
    try {
      rawBody = await readBoundedRequestBody(req, MAX_LITECOIN_WEBHOOK_BYTES);
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
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const { event, txid, tx_hash, address } = payload || {};
    const txHash = txid || tx_hash;
    const targetAddress = typeof address === 'string' ? address.trim() : '';
    const rawOutputIndex = payload?.output_index;
    const parsedIndex = typeof rawOutputIndex === 'number'
      ? (Number.isSafeInteger(rawOutputIndex) && rawOutputIndex >= 0 ? rawOutputIndex : null)
      : typeof rawOutputIndex === 'string' && /^\d{1,16}$/.test(rawOutputIndex)
        ? Number(rawOutputIndex)
        : null;

    // Never default an absent output index to zero. Transaction/output identity
    // must be supplied explicitly and then independently verified against Litecoin.
    if (
      typeof txHash !== 'string' ||
      !/^[a-fA-F0-9]{64}$/.test(txHash) ||
      !targetAddress ||
      parsedIndex === null ||
      !Number.isSafeInteger(parsedIndex)
    ) {
      return NextResponse.json({ error: 'Invalid deposit transaction/output identity' }, { status: 400 });
    }

    // Payload amount/confirmations/network fields are untrusted; verify against Litecoin mainnet.
    const verified = await verifyUtxoDepositOutput('LTC', txHash, targetAddress, parsedIndex);
    if (!verified) {
      return NextResponse.json({ success: false, status: 'pending_or_unverified' }, { status: 202 });
    }

    const supabaseAdmin = getSupabaseAdminClient();
    const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('register_pending_deposit', {
      p_destination_address: verified.address,
      p_asset_symbol: 'LTC',
      p_network_code: 'LTC',
      p_amount: verified.amount,
      p_tx_hash: verified.txid,
      p_output_index: verified.outputIndex,
      p_block_number: verified.blockHeight,
      p_from_address: null,
      p_token_contract: null,
      p_confirmations: 0,
      p_provider: 'litecoin_webhook_pending',
    });

    if (rpcErr) {
      console.error('[LTC Webhook] Canonical pending-registration RPC failed:', {
        code: rpcErr.code || 'UNKNOWN',
      });
      return NextResponse.json({ success: false, error: 'deposit_processing_failed' }, { status: 503 });
    }

    return NextResponse.json({
      success: true,
      event: typeof event === 'string' ? event : 'tx_confirmed',
      network: 'LTC',
      txid: verified.txid,
      address: verified.address,
      amount: verified.amount,
      confirmations: verified.confirmations,
      result: rpcData,
      processed_at: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[LTC Webhook] Processing failed:', message);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
