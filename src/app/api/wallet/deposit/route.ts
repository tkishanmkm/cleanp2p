import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { normalizeDepositNetwork } from '@/lib/hd-derivation-engine';
import { CANONICAL_USDT_CONTRACTS } from '@/jobs/depositIngestion';

export async function POST(req: Request) {
  // This endpoint credits balances through a privileged RPC. It must fail closed
  // if the webhook secret is not configured or the caller cannot prove possession.
  const webhookSecret = process.env.BLOCKCHAIN_WEBHOOK_SECRET;
  if (!webhookSecret || !webhookSecret.trim()) {
    console.error('[POST /api/wallet/deposit] Webhook authentication is not configured.');
    return NextResponse.json({ error: 'Deposit endpoint unavailable.' }, { status: 503 });
  }

  const authHeader = req.headers.get('authorization') || '';
  const suppliedSecret = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';
  const supplied = Buffer.from(suppliedSecret, 'utf8');
  const expected = Buffer.from(webhookSecret, 'utf8');
  if (
    supplied.length === 0 ||
    supplied.length !== expected.length ||
    !crypto.timingSafeEqual(supplied, expected)
  ) {
    return NextResponse.json({ error: 'Unauthorized webhook.' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid deposit payload.' }, { status: 400 });
    }

    const { assetCode, networkCode, amount, txHash, destinationAddress } = body;
    const outputIndex = body.outputIndex === undefined ? 0 : body.outputIndex;

    if (
      typeof assetCode !== 'string' ||
      !assetCode.trim() ||
      typeof networkCode !== 'string' ||
      !networkCode.trim() ||
      typeof txHash !== 'string' ||
      !txHash.trim() ||
      typeof destinationAddress !== 'string' ||
      !destinationAddress.trim() ||
      typeof amount !== 'number' ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !Number.isSafeInteger(outputIndex) ||
      outputIndex < 0
    ) {
      return NextResponse.json({ error: 'Invalid deposit payload.' }, { status: 400 });
    }

    const normNet = normalizeDepositNetwork(networkCode);
    const normAsset = assetCode.trim().toUpperCase();
    if (!['BTC', 'ETH', 'LTC', 'USDT'].includes(normAsset)) {
      return NextResponse.json({ error: 'Unsupported deposit asset.' }, { status: 400 });
    }
    if (!['BTC', 'LTC', 'ETH', 'ERC20', 'BEP20', 'TRC20'].includes(normNet)) {
      return NextResponse.json({ error: 'Unsupported deposit network.' }, { status: 400 });
    }

    const tokenContract = normAsset === 'USDT' ? CANONICAL_USDT_CONTRACTS[normNet] || null : null;
    if (normAsset === 'USDT' && !tokenContract) {
      return NextResponse.json({ error: 'Unsupported USDT network.' }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase.rpc('process_deposit_atomic', {
      p_destination_address: destinationAddress.trim(),
      p_asset_symbol: normAsset,
      p_network_code: normNet,
      p_amount: amount,
      p_tx_hash: txHash.trim(),
      p_output_index: outputIndex,
      p_block_number: null,
      p_from_address: null,
      p_token_contract: tokenContract,
      p_confirmations: 12,
      p_provider: 'wallet_deposit_api',
    });

    if (error) {
      console.error('[POST /api/wallet/deposit] Deposit RPC failed.');
      return NextResponse.json({ error: 'Unable to process deposit.' }, { status: 400 });
    }

    return NextResponse.json(data);
  } catch {
    console.error('[POST /api/wallet/deposit] Request failed.');
    return NextResponse.json({ error: 'Unable to process deposit.' }, { status: 500 });
  }
}
