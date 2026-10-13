import { NextRequest, NextResponse } from 'next/server';
import { SYSTEM_CONFIG } from '@/lib/config/env';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { CANONICAL_USDT_CONTRACTS } from '@/jobs/depositIngestion';
import { verifyHmacSha256 } from '@/lib/webhooks/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const rawBody = await req.text();
    const secret = SYSTEM_CONFIG.secrets.webhook || process.env.ALCHEMY_WEBHOOK_SIGNING_KEY;
    if (!secret?.trim()) {
      return NextResponse.json({ error: 'Webhook authentication is not configured' }, { status: 503 });
    }
    if (!verifyHmacSha256(rawBody, req.headers.get('x-alchemy-signature'), secret)) {
      return NextResponse.json({ error: 'Unauthorized webhook' }, { status: 401 });
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const network = payload.event?.network ?? payload.network;
    if (network && network !== 'ETH_MAINNET') {
      return NextResponse.json({ error: 'Unsupported network' }, { status: 400 });
    }

    const activity = payload.event?.activity;
    if (!Array.isArray(activity) || activity.length !== 1) {
      return NextResponse.json({ error: 'Expected exactly one activity item' }, { status: 400 });
    }

    const item = activity[0];
    const toAddress = typeof item.toAddress === 'string' ? item.toAddress.trim() : '';
    const fromAddress = typeof item.fromAddress === 'string' ? item.fromAddress.trim() : null;
    const amount = Number(item.value);
    const rawAsset = typeof item.asset === 'string' ? item.asset.toUpperCase().trim() : '';
    const txHash = typeof item.hash === 'string' ? item.hash.trim() : '';
    const blockNumber = typeof item.blockNum === 'string' && /^0x[0-9a-f]+$/i.test(item.blockNum)
      ? Number.parseInt(item.blockNum, 16) : null;
    const logIndex = item.logIndex;

    if (!toAddress || !/^0x[a-f0-9]{40}$/i.test(toAddress) ||
        !/^0x[a-f0-9]{64}$/i.test(txHash) || !Number.isFinite(amount) || amount <= 0 ||
        !Number.isInteger(logIndex) || logIndex < 0 ||
        !['ETH', 'USDT'].includes(rawAsset)) {
      return NextResponse.json({ error: 'Invalid activity data' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdminClient();
    const normNet = rawAsset === 'ETH' ? 'ETH' : 'ERC20';
    const assetSymbol = rawAsset;
    const tokenContract = CANONICAL_USDT_CONTRACTS[normNet] || null;
    if (rawAsset === 'USDT') {
      const observedContract = typeof item.rawContract?.address === 'string'
        ? item.rawContract.address.trim().toLowerCase()
        : '';
      if (!tokenContract || !observedContract || observedContract !== tokenContract.toLowerCase()) {
        return NextResponse.json({ error: 'Unrecognized token contract' }, { status: 400 });
      }
    }

    const { data: rpcData, error: creditError } = await supabaseAdmin.rpc('process_deposit_atomic', {
      p_destination_address: toAddress,
      p_asset_symbol: assetSymbol,
      p_network_code: normNet,
      p_amount: amount,
      p_tx_hash: txHash,
      p_output_index: logIndex,
      p_block_number: blockNumber,
      p_from_address: fromAddress,
      p_token_contract: tokenContract,
      // This value is not an independent chain confirmation; downstream verification remains required.
      p_confirmations: 0,
      p_provider: 'alchemy_webhook',
    });

    if (creditError) {
      console.error('[Alchemy Webhook] Canonical deposit processing failed');
      return NextResponse.json({ success: false, error: 'Deposit processing failed' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Deposit event accepted for canonical processing', data: rpcData });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
