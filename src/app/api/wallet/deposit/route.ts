import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { normalizeDepositNetwork } from '@/lib/hd-derivation-engine';
import { CANONICAL_USDT_CONTRACTS } from '@/jobs/depositIngestion';

export async function POST(req: Request) {
  try {
    const supabase = getSupabaseAdminClient();
    const authHeader = req.headers.get('authorization');
    const webhookSecret = process.env.BLOCKCHAIN_WEBHOOK_SECRET?.trim();

    // This endpoint can invoke a privileged financial RPC; it must never be unauthenticated.
    if (!webhookSecret || webhookSecret.length < 32) {
      console.error('BLOCKCHAIN_WEBHOOK_SECRET is missing or too short; refusing webhook requests.');
      return NextResponse.json({ error: 'Webhook authentication is not configured' }, { status: 503 });
    }
    if (authHeader !== `Bearer ${webhookSecret}`) {
      return NextResponse.json({ error: 'Unauthorized webhook' }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid deposit payload' }, { status: 400 });
    }
    const { userId, assetCode, networkCode, amount, txHash, destinationAddress, outputIndex = 0 } = body;

    if (
      typeof assetCode !== 'string' || !assetCode.trim() ||
      typeof networkCode !== 'string' || !networkCode.trim() ||
      typeof txHash !== 'string' || !txHash.trim() ||
      typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 ||
      !Number.isSafeInteger(outputIndex) || outputIndex < 0
    ) {
      return NextResponse.json({ error: 'Invalid or missing deposit payload fields' }, { status: 400 });
    }

    const normNet = normalizeDepositNetwork(networkCode);
    const normAsset = assetCode.toUpperCase().trim();
    const tokenContract = CANONICAL_USDT_CONTRACTS[normNet] || null;

    let targetAddress = destinationAddress;
    if (!targetAddress && userId) {
      // Lookup user's deposit address
      const { data: addrData } = await supabase
        .from('deposit_addresses')
        .select('address')
        .eq('user_id', userId)
        .eq('network_code', normNet)
        .maybeSingle();

      targetAddress = addrData?.address;

      if (!targetAddress) {
        const { data: uAddr } = await supabase
          .from('user_deposit_addresses')
          .select('address')
          .eq('user_id', userId)
          .eq('network', normNet)
          .maybeSingle();
        targetAddress = uAddr?.address;
      }
    }

    if (!targetAddress) {
      return NextResponse.json({ error: 'Deposit destination address not found' }, { status: 400 });
    }

    const { data, error } = await supabase.rpc('process_deposit_atomic', {
      p_destination_address: targetAddress,
      p_asset_symbol: normAsset,
      p_network_code: normNet,
      p_amount: Number(amount),
      p_tx_hash: txHash,
      p_output_index: Number(outputIndex) || 0,
      p_block_number: null,
      p_from_address: null,
      p_token_contract: tokenContract,
      p_confirmations: 12,
      p_provider: 'wallet_deposit_api',
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
