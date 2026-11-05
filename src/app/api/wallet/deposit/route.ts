import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { normalizeDepositNetwork } from '@/lib/hd-derivation-engine';
import { CANONICAL_USDT_CONTRACTS } from '@/jobs/depositIngestion';
import { getEvmProvider } from '@/lib/blockchain/providers';
import { resolveUniqueEvmTransferEvidence } from '@/lib/blockchain/resolve-evm-transfer-log-index';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';

export async function POST(req: Request) {
  try {
    const auth = verifyWorkerAuth(req, {
      allowedSecrets: [process.env.BLOCKCHAIN_WEBHOOK_SECRET, process.env.CHAIN_INGEST_SECRET],
      customHeaderNames: ['x-webhook-secret', 'x-ingest-secret'],
    });
    if (!auth.authorized) {
      return NextResponse.json({ error: 'Unauthorized webhook' }, { status: 401 });
    }

    const supabase = getSupabaseAdminClient();

    const body = await req.json().catch(() => ({}));
    const { userId, assetCode, networkCode, amount, txHash, destinationAddress, outputIndex } = body;

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

    const amountText = typeof amount === 'string'
      ? amount.trim()
      : typeof amount === 'number' && Number.isFinite(amount)
        ? String(amount)
        : '';
    if (!/^(?:0|[1-9]\\d*)(?:\\.\\d+)?$/.test(amountText) ||
        BigInt(amountText.replace('.', '') || '0') <= 0n ||
        typeof txHash !== 'string') {
      return NextResponse.json({ error: 'Invalid deposit amount or transaction hash' }, { status: 400 });
    }

    let verifiedAmount = amountText;
    let resolvedOutputIndex: number;
    if (normNet === 'ERC20' || normNet === 'BEP20') {
      if (!tokenContract || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
        return NextResponse.json({ error: 'Invalid token transfer identity' }, { status: 400 });
      }
      try {
        const provider = getEvmProvider(normNet);
        const [transaction, receipt] = await Promise.all([
          provider.getTransaction(txHash),
          provider.getTransactionReceipt(txHash),
        ]);
        const providerNetwork = await provider.getNetwork();
        const expectedChainId = normNet === 'BEP20' ? 56n : 1n;
        if (!transaction || !receipt || receipt.status !== 1 ||
            providerNetwork.chainId !== expectedChainId ||
            (transaction.chainId != null && transaction.chainId !== expectedChainId) ||
            typeof transaction.to !== 'string' || transaction.to.toLowerCase() !== tokenContract.toLowerCase() ||
            receipt.hash.toLowerCase() !== txHash.toLowerCase()) {
          return NextResponse.json({ error: 'On-chain token transfer evidence is unavailable or invalid' }, { status: 503 });
        }
        const evidence = resolveUniqueEvmTransferEvidence({
          receipt, txHash, tokenContract, destinationAddress: targetAddress,
          decimals: normNet === 'ERC20' ? 6 : 18,
        });
        if (!evidence) {
          return NextResponse.json({ error: 'Could not uniquely match token transfer log' }, { status: 422 });
        }
        resolvedOutputIndex = evidence.index;
        verifiedAmount = evidence.amount;
      } catch {
        return NextResponse.json({ error: 'Unable to verify token transfer with chain provider' }, { status: 503 });
      }
    } else if (normNet === 'ETH') {
      try {
        const provider = getEvmProvider('ETH');
        const [transaction, receipt, providerNetwork] = await Promise.all([
          provider.getTransaction(txHash),
          provider.getTransactionReceipt(txHash),
          provider.getNetwork(),
        ]);
        if (!/^0x[a-fA-F0-9]{64}$/.test(txHash) ||
            providerNetwork.chainId !== 1n ||
            !transaction || !receipt || receipt.status !== 1 ||
            receipt.hash.toLowerCase() !== txHash.toLowerCase() ||
            !transaction.to || transaction.to.toLowerCase() !== targetAddress.toLowerCase() ||
            transaction.value <= 0n) {
          return NextResponse.json({ error: 'On-chain native transfer evidence is unavailable or invalid' }, { status: 503 });
        }
        verifiedAmount = ethers.formatUnits(transaction.value, 18);
        resolvedOutputIndex = 0;
      } catch {
        return NextResponse.json({ error: 'Unable to verify native transfer with chain provider' }, { status: 503 });
      }
    } else {
      resolvedOutputIndex = Number(outputIndex);
      if (!Number.isSafeInteger(resolvedOutputIndex) || resolvedOutputIndex < 0) {
        return NextResponse.json({ error: 'A valid output/event index is required' }, { status: 400 });
      }
    }

    const { data, error } = await supabase.rpc('register_pending_deposit', {
      p_destination_address: targetAddress,
      p_asset_symbol: normAsset,
      p_network_code: normNet,
      p_amount: verifiedAmount,
      p_tx_hash: txHash,
      p_output_index: resolvedOutputIndex,
      p_block_number: null,
      p_from_address: null,
      p_token_contract: tokenContract,
      p_confirmations: 0, // This ingress cannot assert confirmations; chain-verification worker must do so.
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
