import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { normalizeDepositNetwork } from '@/lib/hd-derivation-engine';
import { CANONICAL_USDT_CONTRACTS } from '@/jobs/depositIngestion';

export async function POST(req: Request) {
  try {
    const supabase = getSupabaseAdminClient();
    const authHeader = req.headers.get('authorization');
    const webhookSecret = process.env.BLOCKCHAIN_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('[Deposit API] BLOCKCHAIN_WEBHOOK_SECRET is not configured; refusing deposit processing.');
      return NextResponse.json({ error: 'Deposit processing is temporarily unavailable' }, { status: 503 });
    }
    if (authHeader !== `Bearer ${webhookSecret}`) {
      return NextResponse.json({ error: 'Unauthorized webhook' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { userId, assetCode, networkCode, amount, txHash, destinationAddress, outputIndex = 0, confirmations, blockNumber } = body;

    const parsedAmount = Number(amount);
    const parsedOutputIndex = Number(outputIndex);
    const parsedConfirmations = Number(confirmations);
    const parsedBlockNumber = Number(blockNumber);

    if (
      typeof assetCode !== 'string' || !assetCode.trim() ||
      typeof networkCode !== 'string' || !networkCode.trim() ||
      typeof txHash !== 'string' || !txHash.trim() ||
      !Number.isFinite(parsedAmount) || parsedAmount <= 0 ||
      !Number.isSafeInteger(parsedOutputIndex) || parsedOutputIndex < 0 ||
      !Number.isSafeInteger(parsedConfirmations) || parsedConfirmations < 0 ||
      !Number.isSafeInteger(parsedBlockNumber) || parsedBlockNumber <= 0
    ) {
      return NextResponse.json({ error: 'Invalid deposit payload; positive amount, transaction, block and explicit confirmation data are required' }, { status: 400 });
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
      p_amount: parsedAmount,
      p_tx_hash: txHash.trim(),
      p_output_index: parsedOutputIndex,
      p_block_number: parsedBlockNumber,
      p_from_address: null,
      p_token_contract: tokenContract,
      p_confirmations: parsedConfirmations,
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
