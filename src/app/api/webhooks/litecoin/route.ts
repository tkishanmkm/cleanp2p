import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

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

const LTC_TX_HASH_RE = /^[0-9a-fA-F]{64}$/;
const LTC_ADDRESS_RE = /^(?:ltc1[ac-hj-np-z02-9]{11,87}|[LM3][1-9A-HJ-NP-Za-km-z]{25,36})$/;
const DECIMAL_LTC_RE = /^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/;

function parseLtcAmount(input: unknown): number | null {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  if (typeof input === 'number' && !Number.isFinite(input)) return null;
  const text = String(input);
  if (!DECIMAL_LTC_RE.test(text)) return null;
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
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
    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return NextResponse.json({ error: 'Invalid deposit payload' }, { status: 400 });
    }

    const body = payload as Record<string, unknown>;
    const txHashCandidate = typeof body.txid === 'string' && body.txid.trim()
      ? body.txid.trim()
      : typeof body.tx_hash === 'string' ? body.tx_hash.trim() : '';
    if (!LTC_TX_HASH_RE.test(txHashCandidate)) {
      return NextResponse.json({ error: 'Invalid transaction hash' }, { status: 400 });
    }

    if (typeof body.address !== 'string') {
      return NextResponse.json({ error: 'Invalid destination address' }, { status: 400 });
    }
    const targetAddress = body.address.trim();
    if (targetAddress !== body.address || !LTC_ADDRESS_RE.test(targetAddress)) {
      return NextResponse.json({ error: 'Invalid destination address' }, { status: 400 });
    }

    const amountInput = body.amount !== undefined && body.amount !== null ? body.amount : body.value;
    const depositAmount = parseLtcAmount(amountInput);
    if (depositAmount === null) {
      return NextResponse.json({ error: 'Invalid deposit amount' }, { status: 400 });
    }

    // Never invent output index or confirmation values when they are absent/malformed.
    if (!Number.isSafeInteger(body.output_index) || (body.output_index as number) < 0) {
      return NextResponse.json({ error: 'Invalid output index' }, { status: 400 });
    }
    if (!Number.isSafeInteger(body.confirmations) || (body.confirmations as number) < 0) {
      return NextResponse.json({ error: 'Invalid confirmations value' }, { status: 400 });
    }

    let blockHeight: number | null = null;
    if (body.block_height !== undefined && body.block_height !== null) {
      if (!Number.isSafeInteger(body.block_height) || (body.block_height as number) < 0) {
        return NextResponse.json({ error: 'Invalid block height' }, { status: 400 });
      }
      blockHeight = body.block_height as number;
    }

    const supabaseAdmin = getSupabaseAdminClient();
    const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('process_deposit_atomic', {
      p_destination_address: targetAddress,
      p_asset_symbol: 'LTC',
      p_network_code: 'LTC',
      p_amount: depositAmount,
      p_tx_hash: txHashCandidate,
      p_output_index: body.output_index as number,
      p_block_number: blockHeight,
      p_from_address: null,
      p_token_contract: null,
      // This is provider-reported data, not independent chain verification.
      p_confirmations: body.confirmations as number,
      p_provider: 'litecoin_webhook',
    });

    if (rpcErr) {
      console.error('[LTC Webhook] Canonical deposit processing error:', rpcErr.message);
      return NextResponse.json(
        { success: false, error: 'Deposit processing failed' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      event: typeof body.event === 'string' ? body.event : 'tx_confirmed',
      network: 'LTC',
      txid: txHashCandidate,
      address: targetAddress,
      amount: depositAmount,
      confirmations: body.confirmations,
      result: rpcData,
      processed_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[LTC Webhook] Request processing failed:', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
