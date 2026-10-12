import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Reject unauthenticated provider callbacks before they can reach the privileged deposit RPC.
 * Configure a provider-compatible signed gateway/header before enabling this endpoint.
 */
function verifyWebhookSecret(req: Request): 'ok' | 'missing-config' | 'unauthorized' {
  const secret = process.env.LITECOIN_WEBHOOK_SECRET
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

export async function POST(req: NextRequest) {

  const authResult = verifyWebhookSecret(req);
  if (authResult === 'missing-config') {
    return NextResponse.json({ error: 'Webhook authentication is not configured' }, { status: 503 });
  }
  if (authResult !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized webhook request' }, { status: 401 });
  }

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
