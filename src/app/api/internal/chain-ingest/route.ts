import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { normalizeDepositNetwork } from '@/lib/hd-derivation-engine';
import { CANONICAL_USDT_CONTRACTS } from '@/jobs/depositIngestion';
import { timingSafeEqualString } from '@/lib/security/worker-auth';

interface IngestPayload {
  networkCode: string;
  txid: string;
  outputIndex?: number | string;
  toAddress: string;
  fromAddress?: string;
  assetCode: string;
  // Monetary values must cross this service boundary as decimal strings.
  // JavaScript Number cannot preserve arbitrary token/UTXO precision.
  amount: string;
  blockHeight?: number | string;
  // confirmations are deliberately ignored; only confirmationsWorker verifies chain state.
}

function getNetworkRules(network: string): { asset: string; decimals: number } | null {
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
    !isAsciiDigits(whole) ||
    (whole.length > 1 && whole.startsWith('0')) ||
    (decimalPoint !== -1 && !isAsciiDigits(fraction)) ||
    fraction.length > maxDecimals
  ) {
    return null;
  }

  try {
    return BigInt(whole + fraction) > 0n ? text : null;
  } catch {
    return null;
  }
}

function isValidTransactionId(network: string, txid: string): boolean {
  if (network === 'ETH' || network === 'ERC20' || network === 'BEP20') {
    return txid.length === 66 && txid.startsWith('0x') && /^[a-fA-F0-9]{64}$/.test(txid.slice(2));
  }
  return txid.length === 64 && /^[a-fA-F0-9]{64}$/.test(txid);
}

function parseNonNegativeSafeInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value === 'string' && /^\d{1,16}$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const providedSecret = req.headers.get('x-ingest-secret');
    const configuredSecret = process.env.CHAIN_INGEST_SECRET;

    if (!configuredSecret || !providedSecret || !timingSafeEqualString(providedSecret, configuredSecret)) {
      return NextResponse.json(
        { error: 'Unauthorized: Invalid or missing x-ingest-secret header.' },
        { status: 401 }
      );
    }

    let body: IngestPayload;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
    }

    const {
      networkCode,
      txid,
      toAddress,
      fromAddress,
      assetCode,
      amount,
      blockHeight,
    } = body;

    if (
      typeof networkCode !== 'string' || !networkCode.trim() ||
      typeof txid !== 'string' || !txid.trim() ||
      typeof toAddress !== 'string' || !toAddress.trim() ||
      typeof assetCode !== 'string' || !assetCode.trim()
    ) {
      return NextResponse.json(
        { error: 'Bad Request: Missing or invalid transaction identity fields.' },
        { status: 400 }
      );
    }

    if (fromAddress !== undefined && fromAddress !== null && typeof fromAddress !== 'string') {
      return NextResponse.json({ error: 'Bad Request: Invalid sender address.' }, { status: 400 });
    }

    const normNet = normalizeDepositNetwork(networkCode);
    const normAsset = assetCode.toUpperCase().trim();
    const networkRules = getNetworkRules(normNet);
    const decimals = networkRules?.decimals;

    if (!networkRules || decimals === undefined || normAsset !== networkRules.asset) {
      return NextResponse.json(
        { error: 'Bad Request: Unsupported asset/network combination.' },
        { status: 400 }
      );
    }

    const cleanTxid = txid.trim();
    if (!isValidTransactionId(normNet, cleanTxid)) {
      return NextResponse.json({ error: 'Bad Request: Invalid transaction hash for network.' }, { status: 400 });
    }

    const exactAmount = parsePositiveDecimalAmount(amount, decimals);
    if (!exactAmount) {
      return NextResponse.json(
        { error: 'Bad Request: amount must be a positive decimal string with at most ' + decimals + ' decimal places.' },
        { status: 400 }
      );
    }

    // The transaction/output identity is part of the idempotency key.
    // Never silently map an absent/invalid log or UTXO index to output zero.
    const nativeEthTransfer = normNet === 'ETH' && normAsset === 'ETH';
    const rawOutputIndex = body.outputIndex;
    const outputIndex = rawOutputIndex === undefined || rawOutputIndex === null
      ? (nativeEthTransfer ? 0 : null)
      : parseNonNegativeSafeInteger(rawOutputIndex);

    if (outputIndex === null || (nativeEthTransfer && outputIndex !== 0)) {
      return NextResponse.json(
        { error: 'Bad Request: a valid transaction output/event index is required.' },
        { status: 400 }
      );
    }

    const parsedBlockHeight = blockHeight === undefined || blockHeight === null
      ? null
      : parseNonNegativeSafeInteger(blockHeight);
    if (blockHeight !== undefined && blockHeight !== null && (parsedBlockHeight === null || parsedBlockHeight === 0)) {
      return NextResponse.json({ error: 'Bad Request: invalid block height.' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdminClient();
    const tokenContract = getCanonicalTokenContract(normNet);

    // Ingress is never allowed to credit balances. Supplied confirmation counts
    // are ignored; the separate confirmations worker independently verifies chain state.
    const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('register_pending_deposit', {
      p_destination_address: toAddress.trim(),
      p_asset_symbol: normAsset,
      p_network_code: normNet,
      p_amount: exactAmount,
      p_tx_hash: cleanTxid,
      p_output_index: outputIndex,
      p_block_number: parsedBlockHeight,
      p_from_address: fromAddress?.trim() || null,
      p_token_contract: tokenContract,
      p_confirmations: 0,
      p_provider: 'chain_ingest_internal',
    });

    if (rpcErr) {
      console.error('[Chain Ingest] Canonical pending-registration RPC failed:', {
        code: rpcErr.code || 'UNKNOWN',
      });
      return NextResponse.json(
        { error: 'Canonical pending-deposit registration failed.' },
        { status: 503 }
      );
    }

    return NextResponse.json({ success: true, result: rpcData }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error.';
    console.error('[Chain Ingest] Unexpected ingestion failure:', message);
    return NextResponse.json(
      { error: 'Internal Server Error: Chain ingestion could not be completed.' },
      { status: 500 }
    );
  }
}
