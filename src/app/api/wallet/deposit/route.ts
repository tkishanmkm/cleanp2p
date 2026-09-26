import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { normalizeDepositNetwork } from '@/lib/hd-derivation-engine';
import { CANONICAL_USDT_CONTRACTS } from '@/jobs/depositIngestion';

export async function POST(req: Request) {
  try {
    const supabase = getSupabaseAdminClient();
    const authHeader = req.headers.get('authorization');
    const webhookSecret = process.env.BLOCKCHAIN_WEBHOOK_SECRET;

    if (webhookSecret && authHeader !== `Bearer ${webhookSecret}`) {
      return NextResponse.json({ error: 'Unauthorized webhook' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { userId, assetCode, networkCode, amount, txHash, destinationAddress, outputIndex = 0 } = body;

    if (!assetCode || !amount || !txHash) {
      return NextResponse.json({ error: 'Missing deposit payload fields' }, { status: 400 });
    }

    const normNet = normalizeDepositNetwork(networkCode || 'ERC20');
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
