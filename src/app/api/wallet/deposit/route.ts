import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { normalizeDepositNetwork } from '@/lib/hd-derivation-engine';
import { CANONICAL_USDT_CONTRACTS } from '@/jobs/depositIngestion';
import { getEvmProvider } from '@/lib/blockchain/providers';
import { resolveUniqueEvmTransferEvidence } from '@/lib/blockchain/resolve-evm-transfer-log-index';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';
import { readBoundedRequestBody } from '@/lib/security/read-bounded-request-body';
import { parseDepositRpcResult } from '@/lib/deposit-rpc-result';

const MAX_WALLET_DEPOSIT_BODY_BYTES = 256 * 1024;

function getDepositRules(network: string): { asset: string; decimals: number } | null {
  switch (network) {
    case 'BTC': return { asset: 'BTC', decimals: 8 };
    case 'LTC': return { asset: 'LTC', decimals: 8 };
    case 'ETH': return { asset: 'ETH', decimals: 18 };
    case 'ERC20': return { asset: 'USDT', decimals: 6 };
    case 'BEP20': return { asset: 'USDT', decimals: 18 };
    case 'TRC20': return { asset: 'USDT', decimals: 6 };
    default: return null;
  }
}

function getCanonicalTokenContract(network: string): string | null {
  switch (network) {
    case 'ERC20': return CANONICAL_USDT_CONTRACTS.ERC20;
    case 'BEP20': return CANONICAL_USDT_CONTRACTS.BEP20;
    case 'TRC20': return CANONICAL_USDT_CONTRACTS.TRC20;
    default: return null;
  }
}

function isAsciiDigits(value: string): boolean {
  if (value.length === 0) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

function parsePositiveDecimalAmount(value: unknown, maxDecimals: number): string | null {
  if (typeof value !== 'string' || value.length > 128) return null;
  const text = value.trim();
  const decimalPoint = text.indexOf('.');
  if (decimalPoint !== -1 && text.indexOf('.', decimalPoint + 1) !== -1) return null;

  const whole = decimalPoint === -1 ? text : text.slice(0, decimalPoint);
  const fraction = decimalPoint === -1 ? '' : text.slice(decimalPoint + 1);
  if (
    whole.length === 0 ||
    (whole.length > 1 && whole.startsWith('0')) ||
    !isAsciiDigits(whole) ||
    (decimalPoint !== -1 && !isAsciiDigits(fraction)) ||
    fraction.length > maxDecimals
  ) return null;

  try {
    return BigInt(whole + fraction) > 0n ? text : null;
  } catch {
    return null;
  }
}

function parseNonNegativeSafeInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value === 'string' && value.length <= 16 && isAsciiDigits(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

function isValidTransactionHash(network: string, txHash: string): boolean {
  if (network === 'ETH' || network === 'ERC20' || network === 'BEP20') {
    return txHash.length === 66 && txHash.startsWith('0x') && /^[a-fA-F0-9]{64}$/.test(txHash.slice(2));
  }
  return txHash.length === 64 && /^[a-fA-F0-9]{64}$/.test(txHash);
}

export async function POST(req: Request) {
  try {
    const auth = verifyWorkerAuth(req, {
      allowedSecrets: [process.env.BLOCKCHAIN_WEBHOOK_SECRET, process.env.CHAIN_INGEST_SECRET],
      customHeaderNames: ['x-webhook-secret', 'x-ingest-secret'],
    });
    if (!auth.authorized) {
      return NextResponse.json({ error: 'Unauthorized webhook' }, { status: 401 });
    }

    let rawBody: string | null;
    try {
      rawBody = await readBoundedRequestBody(req, MAX_WALLET_DEPOSIT_BODY_BYTES);
    } catch {
      return NextResponse.json({ error: 'Invalid UTF-8 request body.' }, { status: 400 });
    }
    if (rawBody === null) {
      return NextResponse.json({ error: 'Request body is too large.' }, { status: 413 });
    }

    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
    }

    const { userId, assetCode, networkCode, amount, txHash, destinationAddress, outputIndex } = body;

    if (
      typeof assetCode !== 'string' || !assetCode.trim() ||
      typeof txHash !== 'string' || !txHash.trim() ||
      typeof networkCode !== 'string' && networkCode !== undefined && networkCode !== null
    ) {
      return NextResponse.json({ error: 'Missing or invalid deposit identity fields' }, { status: 400 });
    }

    const normNet = normalizeDepositNetwork(typeof networkCode === 'string' && networkCode.trim() ? networkCode : 'ERC20');
    const normAsset = assetCode.toUpperCase().trim();
    const rules = getDepositRules(normNet);
    if (!rules || normAsset !== rules.asset) {
      return NextResponse.json({ error: 'Unsupported deposit asset/network combination' }, { status: 400 });
    }

    const isReceiptVerifiedEvm = normNet === 'ETH' || normNet === 'ERC20' || normNet === 'BEP20';
    const amountText = parsePositiveDecimalAmount(amount, rules.decimals);
    if (!isReceiptVerifiedEvm && !amountText) {
      return NextResponse.json({ error: 'Deposit amount must be a positive exact decimal string with supported precision' }, { status: 400 });
    }

    const cleanTxHash = txHash.trim();
    if (!isValidTransactionHash(normNet, cleanTxHash)) {
      return NextResponse.json({ error: 'Invalid transaction hash for network' }, { status: 400 });
    }

    const tokenContract = getCanonicalTokenContract(normNet);
    const supabase = getSupabaseAdminClient();

    let targetAddress = typeof destinationAddress === 'string' ? destinationAddress.trim() : '';
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

    let verifiedAmount: string | null = amountText;
    let resolvedOutputIndex: number;
    if (normNet === 'ERC20' || normNet === 'BEP20') {
      if (!tokenContract) {
        return NextResponse.json({ error: 'Invalid token transfer identity' }, { status: 400 });
      }
      try {
        const provider = getEvmProvider(normNet);
        const [transaction, receipt] = await Promise.all([
          provider.getTransaction(cleanTxHash),
          provider.getTransactionReceipt(cleanTxHash),
        ]);
        const providerNetwork = await provider.getNetwork();
        const expectedChainId = normNet === 'BEP20' ? 56n : 1n;
        if (!transaction || !receipt || receipt.status !== 1 ||
            providerNetwork.chainId !== expectedChainId ||
            (transaction.chainId != null && transaction.chainId !== expectedChainId) ||
            typeof transaction.to !== 'string' || transaction.to.toLowerCase() !== tokenContract.toLowerCase() ||
            receipt.hash.toLowerCase() !== cleanTxHash.toLowerCase()) {
          return NextResponse.json({ error: 'On-chain token transfer evidence is unavailable or invalid' }, { status: 503 });
        }
        const evidence = resolveUniqueEvmTransferEvidence({
          receipt, txHash: cleanTxHash, tokenContract, destinationAddress: targetAddress,
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
          provider.getTransaction(cleanTxHash),
          provider.getTransactionReceipt(cleanTxHash),
          provider.getNetwork(),
        ]);
        if (providerNetwork.chainId !== 1n ||
            !transaction || !receipt || receipt.status !== 1 ||
            (transaction.chainId != null && transaction.chainId !== 1n) ||
            receipt.hash.toLowerCase() !== cleanTxHash.toLowerCase() ||
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
      resolvedOutputIndex = parseNonNegativeSafeInteger(outputIndex) ?? -1;
      if (resolvedOutputIndex < 0) {
        return NextResponse.json({ error: 'A valid output/event index is required' }, { status: 400 });
      }
    }

    if (!verifiedAmount) {
      return NextResponse.json({ error: 'A verified exact deposit amount is required' }, { status: 400 });
    }

    const { data, error } = await supabase.rpc('register_pending_deposit', {
      p_destination_address: targetAddress,
      p_asset_symbol: normAsset,
      p_network_code: normNet,
      p_amount: verifiedAmount,
      p_tx_hash: cleanTxHash,
      p_output_index: resolvedOutputIndex,
      p_block_number: null,
      p_from_address: null,
      p_token_contract: tokenContract,
      p_confirmations: 0, // This ingress cannot assert confirmations; chain-verification worker must do so.
      p_provider: 'wallet_deposit_api',
    });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 503 });
    }

    const parsedResult = parseDepositRpcResult(data);
    if (!parsedResult.success) {
      return NextResponse.json({
        success: false,
        error: parsedResult.code || 'deposit_registration_rejected',
        message: parsedResult.message || 'Canonical deposit RPC rejected the candidate.',
        result: parsedResult.raw,
      }, { status: 422 });
    }

    return NextResponse.json(parsedResult.raw, {
      status: parsedResult.status === 'PENDING' ? 202 : 200,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
