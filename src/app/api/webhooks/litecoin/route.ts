import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifySharedWebhookSecret } from '@/lib/webhooks/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.LITECOIN_WEBHOOK_SECRET || process.env.BLOCKCHAIN_WEBHOOK_SECRET;
    if (!secret?.trim()) {
      return NextResponse.json({ error: 'Webhook authentication is not configured' }, { status: 503 });
    }
    if (!verifySharedWebhookSecret(req, secret)) {
      return NextResponse.json({ error: 'Unauthorized webhook' }, { status: 401 });
    }

    const rawBody = await req.text();
    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const { event, txid, tx_hash, address, amount, value, confirmations, output_index, block_height } = payload;
    const txHash = txid || tx_hash;
    const rawAmount = amount ?? value;
    const depositAmount = typeof rawAmount === 'string' && /^\d+(\.\d+)?$/.test(rawAmount)
      ? Number(rawAmount)
      : typeof rawAmount === 'number' ? rawAmount : NaN;
    const targetAddress = typeof address === 'string' ? address.trim() : '';
    const outputIndex = output_index;

    if (typeof txHash !== 'string' || !/^[a-f0-9]{64}$/i.test(txHash) ||
        !targetAddress || !Number.isFinite(depositAmount) || depositAmount <= 0 ||
        !Number.isInteger(outputIndex) || outputIndex < 0) {
      return NextResponse.json({ error: 'Invalid deposit payload' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdminClient();
    const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('process_deposit_atomic', {
      p_destination_address: targetAddress,
      p_asset_symbol: 'LTC',
      p_network_code: 'LTC',
      p_amount: depositAmount,
      p_tx_hash: txHash,
      p_output_index: outputIndex,
      p_block_number: Number.isInteger(block_height) && block_height > 0 ? block_height : null,
      p_from_address: null,
      p_token_contract: null,
      // Do not invent a confirmation count when the provider omits it.
      p_confirmations: Number.isInteger(confirmations) && confirmations >= 0 ? confirmations : 0,
      p_provider: 'litecoin_webhook',
    });

    if (rpcErr) {
      console.error('[LTC Webhook] Canonical deposit RPC failed');
      return NextResponse.json({ success: false, error: 'Deposit processing failed' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      event: event || 'tx_confirmed',
      network: 'LTC',
      txid: txHash,
      address: targetAddress,
      amount: depositAmount,
      confirmations: Number.isInteger(confirmations) && confirmations >= 0 ? confirmations : 0,
      result: rpcData,
      processed_at: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
