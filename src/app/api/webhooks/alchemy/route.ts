import { NextRequest, NextResponse } from 'next/server';
import { SYSTEM_CONFIG } from '@/lib/config/env';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { CANONICAL_USDT_CONTRACTS } from '@/jobs/depositIngestion';
import crypto from 'crypto';

function verifySignature(body: string, signature: string, secret: string): boolean {
  try {
    const hmac = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const sigBuf = Buffer.from(signature, 'utf8');
    const hmacBuf = Buffer.from(hmac, 'utf8');
    if (sigBuf.length !== hmacBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, hmacBuf);
  } catch {
    return false;
  }
}

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const EVM_TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;
const HEX_BLOCK_RE = /^0x[0-9a-fA-F]+$/;

type AlchemyActivity = {
  toAddress?: unknown;
  fromAddress?: unknown;
  value?: unknown;
  asset?: unknown;
  hash?: unknown;
  blockNum?: unknown;
  rawContract?: { address?: unknown } | null;
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-alchemy-signature') ?? '';
    const webhookSecret = SYSTEM_CONFIG.secrets.webhook;

    if (!webhookSecret || !webhookSecret.trim()) {
      console.error('[Alchemy Webhook] BLOCKCHAIN_WEBHOOK_SECRET is not configured');
      return NextResponse.json({ error: 'Webhook authentication is not configured' }, { status: 503 });
    }

    if (!signature || !verifySignature(rawBody, signature, webhookSecret)) {
      return NextResponse.json({ error: 'Invalid or missing HMAC signature' }, { status: 401 });
    }

    let payload: { network?: unknown; event?: { activity?: AlchemyActivity[] } };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    // This handler is wired to Ethereum mainnet's native ETH and ERC-20 USDT.
    if (payload.network !== 'ETH_MAINNET') {
      return NextResponse.json({ error: 'Unsupported or missing blockchain network' }, { status: 400 });
    }

    const activities = payload.event?.activity;
    if (!Array.isArray(activities) || activities.length !== 1) {
      // Do not silently ignore additional activities or partially process a batch.
      return NextResponse.json({ error: 'Expected exactly one deposit activity per webhook' }, { status: 400 });
    }

    const activity = activities[0];
    if (!activity || typeof activity !== 'object') {
      return NextResponse.json({ error: 'Invalid activity data' }, { status: 400 });
    }

    if (typeof activity.toAddress !== 'string' || !EVM_ADDRESS_RE.test(activity.toAddress.trim())) {
      return NextResponse.json({ error: 'Invalid destination address' }, { status: 400 });
    }
    if (typeof activity.hash !== 'string' || !EVM_TX_HASH_RE.test(activity.hash.trim())) {
      return NextResponse.json({ error: 'Invalid transaction hash' }, { status: 400 });
    }
    if (
      activity.fromAddress !== undefined &&
      activity.fromAddress !== null &&
      (typeof activity.fromAddress !== 'string' || !EVM_ADDRESS_RE.test(activity.fromAddress.trim()))
    ) {
      return NextResponse.json({ error: 'Invalid source address' }, { status: 400 });
    }

    const toAddress = activity.toAddress.trim().toLowerCase();
    const fromAddress = typeof activity.fromAddress === 'string'
      ? activity.fromAddress.trim().toLowerCase()
      : null;
    const txHash = activity.hash.trim();
    const amount = typeof activity.value === 'number' || typeof activity.value === 'string'
      ? Number(activity.value)
      : Number.NaN;

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Invalid deposit amount' }, { status: 400 });
    }

    const rawAsset = typeof activity.asset === 'string' ? activity.asset.trim().toUpperCase() : '';
    let assetSymbol: 'ETH' | 'USDT';
    let normNet: 'ETH' | 'ERC20';
    let tokenContract: string | null = null;

    if (rawAsset === 'ETH') {
      assetSymbol = 'ETH';
      normNet = 'ETH';
      if (activity.rawContract?.address) {
        return NextResponse.json({ error: 'Native ETH activity must not specify a token contract' }, { status: 400 });
      }
    } else if (rawAsset === 'USDT') {
      assetSymbol = 'USDT';
      normNet = 'ERC20';
      const suppliedContract = activity.rawContract?.address;
      const expectedContract = CANONICAL_USDT_CONTRACTS.ERC20;
      if (
        typeof suppliedContract !== 'string' ||
        !EVM_ADDRESS_RE.test(suppliedContract.trim()) ||
        suppliedContract.trim().toLowerCase() !== expectedContract.toLowerCase()
      ) {
        return NextResponse.json({ error: 'Unsupported or invalid USDT token contract' }, { status: 400 });
      }
      tokenContract = expectedContract;
    } else {
      return NextResponse.json({ error: 'Unsupported deposit asset' }, { status: 400 });
    }

    let blockNumber: number | null = null;
    if (activity.blockNum !== undefined && activity.blockNum !== null) {
      if (typeof activity.blockNum !== 'string' || !HEX_BLOCK_RE.test(activity.blockNum)) {
        return NextResponse.json({ error: 'Invalid block number' }, { status: 400 });
      }
      const parsedBlockNumber = Number.parseInt(activity.blockNum, 16);
      if (!Number.isSafeInteger(parsedBlockNumber) || parsedBlockNumber < 0) {
        return NextResponse.json({ error: 'Invalid block number' }, { status: 400 });
      }
      blockNumber = parsedBlockNumber;
    }

    const supabaseAdmin = getSupabaseAdminClient();
    const { data: rpcData, error: creditError } = await supabaseAdmin.rpc('process_deposit_atomic', {
      p_destination_address: toAddress,
      p_asset_symbol: assetSymbol,
      p_network_code: normNet,
      p_amount: amount,
      p_tx_hash: txHash,
      p_output_index: 0,
      p_block_number: blockNumber,
      p_from_address: fromAddress,
      p_token_contract: tokenContract,
      p_confirmations: 12,
      p_provider: 'alchemy_webhook',
    });

    if (creditError) {
      console.error('[Alchemy Webhook] Canonical deposit processing error:', creditError.message);
      return NextResponse.json(
        { success: false, error: 'Deposit processing failed' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: 'Deposit processed', data: rpcData });
  } catch (err) {
    console.error('[Alchemy Webhook] Request processing failed:', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
