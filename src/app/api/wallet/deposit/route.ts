import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { normalizeDepositNetwork } from '@/lib/hd-derivation-engine';
import { CANONICAL_USDT_CONTRACTS } from '@/jobs/depositIngestion';

export async function POST(req: Request) {
  try {
    const webhookSecret = process.env.BLOCKCHAIN_WEBHOOK_SECRET;

    // Fail closed: this endpoint credits deposits through a privileged RPC.
    // If the webhook secret is missing, do not accept any request.
    if (!webhookSecret || req.headers.get('authorization') !== `Bearer ${webhookSecret}`) {
      return NextResponse.json({ error: 'Unauthorized webhook' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { userId, assetCode, networkCode, amount, txHash, destinationAddress, outputIndex = 0 } = body;

    if (
      typeof assetCode !== 'string' ||
      !assetCode.trim() ||
      typeof txHash !== 'string' ||
      !txHash.trim() ||
      typeof amount !== 'number' ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !Number.isSafeInteger(Number(outputIndex)) ||
      Number(outputIndex) < 0
    ) {
      return NextResponse.json({ error: 'Invalid deposit payload' }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();
    const normNet = normalizeDepositNetwork(networkCode || 'ERC20');
    const normAsset = assetCode.toUpperCase().trim();
    const tokenContract = CANONICAL_USDT_CONTRACTS[normNet] || null;

    let targetAddress = typeof destinationAddress === 'string' && destinationAddress.trim()
      ? destinationAddress.trim()
      : undefined;

    if (!targetAddress && typeof userId === 'string' && userId.trim()) {
      const { data: addrData, error: addrErr } = await supabase
        .from('deposit_addresses')
        .select('address')
        .eq('user_id', userId)
        .eq('network_code', normNet)
        .maybeSingle();

      if (addrErr) {
        console.error('Deposit address lookup failed:', addrErr.message);
        return NextResponse.json({ error: 'Unable to resolve deposit destination' }, { status: 500 });
      }
      targetAddress = addrData?.address;

      if (!targetAddress) {
        const { data: uAddr, error: uAddrErr } = await supabase
          .from('user_deposit_addresses')
          .select('address')
          .eq('user_id', userId)
          .eq('network', normNet)
          .maybeSingle();

        if (uAddrErr) {
          console.error('Legacy deposit address lookup failed:', uAddrErr.message);
          return NextResponse.json({ error: 'Unable to resolve deposit destination' }, { status: 500 });
        }
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
      p_amount: amount,
      p_tx_hash: txHash.trim(),
      p_output_index: Number(outputIndex),
      p_block_number: null,
      p_from_address: null,
      p_token_contract: tokenContract,
      p_confirmations: 12,
      p_provider: 'wallet_deposit_api',
    });

    if (error) {
      console.error('Atomic deposit processing failed:', error.message);
      return NextResponse.json({ error: 'Deposit processing failed' }, { status: 400 });
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    console.error('POST /api/wallet/deposit error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
