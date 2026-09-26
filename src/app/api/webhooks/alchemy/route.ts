import { NextRequest, NextResponse } from 'next/server';
import { SYSTEM_CONFIG } from '@/lib/config/env';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { normalizeDepositNetwork } from '@/lib/hd-derivation-engine';
import { CANONICAL_USDT_CONTRACTS } from '@/jobs/depositIngestion';
import crypto from 'crypto';

function verifySignature(body: string, signature: string, secret: string): boolean {
  try {
    const hmac = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const sigBuf = Buffer.from(signature);
    const hmacBuf = Buffer.from(hmac);
    if (sigBuf.length !== hmacBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, hmacBuf);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-alchemy-signature') ?? '';

    if (SYSTEM_CONFIG.secrets.webhook && !verifySignature(rawBody, signature, SYSTEM_CONFIG.secrets.webhook)) {
      return NextResponse.json({ error: 'Invalid HMAC signature' }, { status: 401 });
    }

    const payload = JSON.parse(rawBody) as {
      event?: { activity?: Array<{ toAddress: string; fromAddress?: string; value: number; asset: string; hash: string; blockNum?: string }> };
    };
    
    const activity = payload.event?.activity?.[0];

    if (!activity) {
      return NextResponse.json({ error: 'No activity data found' }, { status: 400 });
    }

    const toAddress = activity.toAddress.toLowerCase().trim();
    const fromAddress = activity.fromAddress?.toLowerCase().trim() || null;
    const amount = Number(activity.value);
    const rawAsset = (activity.asset || 'USDT').toUpperCase().trim();
    const txHash = activity.hash;
    const blockNumber = activity.blockNum ? parseInt(activity.blockNum, 16) : null;

    if (!toAddress || !txHash || isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Invalid activity data' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdminClient();
    const normNet = rawAsset === 'ETH' ? 'ETH' : 'ERC20';
    const assetSymbol = rawAsset === 'ETH' ? 'ETH' : 'USDT';
    const tokenContract = CANONICAL_USDT_CONTRACTS[normNet] || null;

    // Process deposit via canonical atomic RPC
    const { data: rpcData, error: creditError } = await supabaseAdmin.rpc('process_deposit_atomic', {
      p_destination_address: toAddress,
      p_asset_symbol: assetSymbol,
      p_network_code: normNet,
      p_amount: amount,
      p_tx_hash: txHash,
      p_output_index: 0,
      p_block_number: isNaN(blockNumber as number) ? null : blockNumber,
      p_from_address: fromAddress,
      p_token_contract: tokenContract,
      p_confirmations: 12,
      p_provider: 'alchemy_webhook',
    });

    if (creditError) {
      console.error('[Alchemy Webhook] Canonical deposit processing error:', creditError.message);
      return NextResponse.json(
        { success: false, error: creditError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: 'Deposit processed', data: rpcData });
  } catch (err: any) {
    console.error('Webhook processing error:', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
