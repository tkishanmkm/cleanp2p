import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';
import { verifyUtxoDepositOutput } from '@/lib/blockchain/verify-utxo-deposit';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // Fail closed: this endpoint credits balances, so it must be authenticated.
  const auth = verifyWorkerAuth(req, {
    allowedSecrets: [process.env.BLOCKCHAIN_WEBHOOK_SECRET, process.env.CHAIN_INGEST_SECRET],
    customHeaderNames: ['x-webhook-secret', 'x-ingest-secret'],
    checkQueryParam: false,
  });
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rawBody = await req.text();
    let payload: any = {};
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const { event, txid, tx_hash, address, output_index = 0 } = payload;
    const txHash = txid || tx_hash;
    const targetAddress = typeof address === 'string' ? address.trim() : '';
    const parsedIndex = Number(output_index);
    if (typeof txHash !== 'string' || !targetAddress || !Number.isSafeInteger(parsedIndex) || parsedIndex < 0) {
      return NextResponse.json({ error: 'Invalid deposit payload' }, { status: 400 });
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
      console.error('[LTC Webhook] Canonical deposit processing error:', rpcErr.message);
      return NextResponse.json({ success: false, error: 'deposit_processing_failed' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      event: event || 'tx_confirmed',
      network: 'LTC',
      txid: verified.txid,
      address: verified.address,
      amount: verified.amount,
      confirmations: verified.confirmations,
      result: rpcData,
      processed_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('Error in POST /api/webhooks/litecoin:', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}