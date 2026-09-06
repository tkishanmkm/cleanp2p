import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import crypto from 'crypto';

// Standardized Token Contract Mapping (EVM Network -> Whitelisted Address)
const SUPPORTED_CONTRACTS: Record<string, Record<string, string>> = {
  'eth-mainnet': {
    USDT: '0xdac17f958d2ee523a2206206994597c13d831ec7',
  },
  'eth-sepolia': {
    USDT: process.env.SEPOLIA_USDT_CONTRACT?.toLowerCase() || '0x7169d38820c256952b1e624b8140312521ec4f70',
  },
};

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-alchemy-signature');
    const webhookSigningKey = process.env.ALCHEMY_WEBHOOK_SIGNING_KEY;

    // Fail-Closed Signature Inspection
    if (!webhookSigningKey) {
      console.error('FATAL: ALCHEMY_WEBHOOK_SIGNING_KEY not set.');
      return NextResponse.json({ error: 'Webhook processing misconfigured' }, { status: 500 });
    }

    if (!signature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
    }

    const expectedSignature = crypto
      .createHmac('sha256', webhookSigningKey)
      .update(rawBody)
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const body = JSON.parse(rawBody);
    const { event } = body;

    if (!event || !event.activity || !Array.isArray(event.activity)) {
      return NextResponse.json({ status: 'ignored' });
    }

    const supabaseAdmin = getSupabaseAdminClient();

    for (const act of event.activity) {
      const network = body.network ? body.network.toLowerCase() : 'eth-mainnet';
      const rawContractAddress = act.rawContract?.address?.toLowerCase();
      const claimedAsset = (act.asset || '').toUpperCase();

      // Native ETH Transfer
      if (claimedAsset === 'ETH' && !rawContractAddress) {
        await processCredit(supabaseAdmin, act.toAddress, 'ETH', network, act.value);
        continue;
      }

      // ERC-20 Token Transfer Verification
      const verifiedContract = SUPPORTED_CONTRACTS[network]?.[claimedAsset];

      if (!verifiedContract || rawContractAddress !== verifiedContract) {
        console.warn(`[SECURITY ALERT] Fraudulent Token Attempt. Network: ${network}, Claimed: ${claimedAsset}, Contract: ${rawContractAddress}`);
        continue; // REJECT Counterfeit Contract
      }

      await processCredit(supabaseAdmin, act.toAddress, claimedAsset, network, act.value);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

async function processCredit(supabaseAdmin: any, toAddress: string, asset: string, network: string, rawAmount: number | string) {
  // Convert string to safe numeric representation avoiding float truncation
  const numericAmount = typeof rawAmount === 'string' ? parseFloat(rawAmount) : rawAmount;
  if (isNaN(numericAmount) || numericAmount <= 0) return;

  // Resolve user account tied to the deposit address
  const { data: addressRecord } = await supabaseAdmin
    .from('deposit_addresses')
    .select('user_id')
    .ilike('address', toAddress)
    .single();

  if (addressRecord?.user_id) {
    await supabaseAdmin.rpc('credit_user_balance', {
      target_user_id: addressRecord.user_id,
      target_asset: asset,
      target_network: network,
      credit_amount: numericAmount,
    });
  }
}

