import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    let payload: any = {};
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const {
      event,
      txid,
      tx_hash,
      address,
      amount,
      value,
      confirmations = 6,
      output_index = 0,
      block_height,
    } = payload;

    const txHash = txid || tx_hash;
    const depositAmount = parseFloat(amount || value || '0');
    const targetAddress = address?.trim();

    if (!txHash || !targetAddress || isNaN(depositAmount) || depositAmount <= 0) {
      return NextResponse.json({ error: 'Invalid deposit payload' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdminClient();

    // Call canonical atomic deposit RPC
    const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('process_deposit_atomic', {
      p_destination_address: targetAddress,
      p_asset_symbol: 'LTC',
      p_network_code: 'LTC',
      p_amount: depositAmount,
      p_tx_hash: txHash,
      p_output_index: Number(output_index) || 0,
      p_block_number: block_height || null,
      p_from_address: null,
      p_token_contract: null,
      p_confirmations: Number(confirmations) || 6,
      p_provider: 'litecoin_webhook',
    });

    if (rpcErr) {
      console.error('[LTC Webhook] Canonical deposit processing error:', rpcErr.message);
      return NextResponse.json(
        { success: false, error: rpcErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      event: event || 'tx_confirmed',
      network: 'LTC',
      txid: txHash,
      address: targetAddress,
      amount: depositAmount,
      confirmations,
      result: rpcData,
      processed_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('Error in POST /api/webhooks/litecoin:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
