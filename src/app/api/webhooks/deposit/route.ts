import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { normalizeDepositNetwork } from '@/lib/hd-derivation-engine';
import { CANONICAL_USDT_CONTRACTS } from '@/jobs/depositIngestion';
import { getEvmProvider } from '@/lib/blockchain/providers';
import { resolveUniqueEvmTransferEvidence } from '@/lib/blockchain/resolve-evm-transfer-log-index';
import { timingSafeEqualString } from '@/lib/security/worker-auth';

export const dynamic = 'force-dynamic';

const MAX_DEPOSIT_WEBHOOK_BYTES = 2 * 1024 * 1024;
const MAX_DEPOSIT_WEBHOOK_ITEMS = 100;

async function readBoundedWebhookBody(req: Request): Promise<string | null> {
  const reader = req.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_DEPOSIT_WEBHOOK_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function positiveDecimalText(value: unknown, maxDecimals: number): string | null {
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

function isAsciiDigits(value: string): boolean {
  if (value.length === 0) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

function getCanonicalTokenContract(network: string): string | null {
  switch (network) {
    case 'ERC20': return CANONICAL_USDT_CONTRACTS.ERC20;
    case 'BEP20': return CANONICAL_USDT_CONTRACTS.BEP20;
    case 'TRC20': return CANONICAL_USDT_CONTRACTS.TRC20;
    default: return null;
  }
}

function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret =
    process.env.BLOCKCHAIN_WEBHOOK_SECRET ||
    process.env.ALCHEMY_WEBHOOK_SIGNING_KEY ||
    process.env.CHAIN_INGEST_SECRET;

  if (!secret) {
    console.error('⛔ [Deposit Webhook] REJECTED: No webhook secret configured in environment (failing closed).');
    return false; // Fail-closed
  }

  if (!signatureHeader) {
    return false;
  }

  try {
    const cleanSignature = signatureHeader.replace(/^sha256=/i, '').trim();
    if (!/^[a-f0-9]{64}$/i.test(cleanSignature)) return false;
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(rawBody, 'utf8');
    const digest = hmac.digest('hex');

    const signatureBuffer = Buffer.from(cleanSignature, 'hex');
    const digestBuffer = Buffer.from(digest, 'hex');

    if (signatureBuffer.length !== digestBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(signatureBuffer, digestBuffer);
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  try {
    const rawBody = await readBoundedWebhookBody(req);
    if (rawBody === null) {
      return NextResponse.json({ error: 'Webhook payload is too large.' }, { status: 413 });
    }
    const signature =
      req.headers.get('x-webhook-signature') ||
      req.headers.get('x-signature') ||
      req.headers.get('x-alchemy-signature');

    // 1. Ingestion Authentication (HTTP 401 on invalid/missing signature)
    const secret =
      process.env.BLOCKCHAIN_WEBHOOK_SECRET ||
      process.env.ALCHEMY_WEBHOOK_SIGNING_KEY ||
      process.env.CHAIN_INGEST_SECRET;

    if (!secret) {
      return NextResponse.json(
        { error: 'SERVER_MISCONFIGURATION: Webhook signing secret is not configured. Failing closed.' },
        { status: 500 }
      );
    }

    const ingestHeader = req.headers.get('x-ingest-secret') || req.headers.get('x-api-key');
    // Compare equal-length buffers only; malformed/incorrect lengths must return 401, not throw 500.
    const isDirectHeaderValid = Boolean(ingestHeader && secret && timingSafeEqualString(ingestHeader, secret));

    if (!isDirectHeaderValid) {
      if (!signature || !verifySignature(rawBody, signature)) {
        return NextResponse.json(
          { error: 'UNAUTHORIZED: Invalid or missing HMAC-SHA256 signature.' },
          { status: 401 }
        );
      }
    }

    let payload: any = {};
    try {
      payload = JSON.parse(rawBody);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdminClient();

    // Standardize event items across providers
    const items: Array<{
      txHash: string;
      logIndex?: number;
      from?: string;
      to: string;
      value: unknown;
      assetSymbol: string;
      network: string;
      confirmations?: number;
      blockNumber?: number;
    }> = [];

    if (Array.isArray(payload.events)) {
      for (const ev of payload.events) {
        items.push({
          txHash: ev.txHash || ev.hash || ev.transactionHash,
          logIndex: ev.logIndex !== undefined && ev.logIndex !== null && Number.isSafeInteger(Number(ev.logIndex)) && Number(ev.logIndex) >= 0 ? Number(ev.logIndex) : undefined,
          from: ev.from || ev.fromAddress,
          to: ev.to || ev.toAddress,
          value: ev.value ?? ev.amount,
          assetSymbol: (ev.assetSymbol || ev.symbol || ev.asset || 'USDT').toUpperCase(),
          network: (ev.network || payload.network || 'ERC20'),
          confirmations: ev.confirmations,
          blockNumber: ev.blockNumber ? parseInt(ev.blockNumber, 10) : undefined,
        });
      }
    } else if (payload.event?.activity && Array.isArray(payload.event.activity)) {
      for (const act of payload.event.activity) {
        items.push({
          txHash: act.hash,
          logIndex: undefined,
          from: act.fromAddress,
          to: act.toAddress,
          value: act.value,
          assetSymbol: (act.asset || 'USDT').toUpperCase(),
          network: 'ERC20',
          blockNumber: act.blockNum ? parseInt(act.blockNum, 16) : undefined,
        });
      }
    } else if (payload.txHash || payload.hash) {
      items.push({
        txHash: payload.txHash || payload.hash,
        logIndex: payload.logIndex !== undefined && payload.logIndex !== null && Number.isSafeInteger(Number(payload.logIndex)) && Number(payload.logIndex) >= 0 ? Number(payload.logIndex) : undefined,
        from: payload.from || payload.fromAddress,
        to: payload.to || payload.toAddress,
        value: payload.value ?? payload.amount,
        assetSymbol: (payload.assetSymbol || payload.symbol || 'USDT').toUpperCase(),
        network: (payload.network || 'ERC20'),
        confirmations: payload.confirmations,
        blockNumber: payload.blockNumber ? parseInt(payload.blockNumber, 10) : undefined,
      });
    }

    if (items.length === 0) {
      return NextResponse.json({ message: 'No transferable log items detected' }, { status: 200 });
    }

    if (items.length > MAX_DEPOSIT_WEBHOOK_ITEMS) {
      return NextResponse.json({ error: 'Too many deposit events in one webhook payload.' }, { status: 413 });
    }

    const processedResults = [];

    for (const item of items) {
      const destinationAddress = typeof item.to === 'string' ? item.to.trim() : '';
      const txHash = typeof item.txHash === 'string' ? item.txHash.trim() : '';
      let outputIndex = item.logIndex;
      const normNet = normalizeDepositNetwork(item.network);
      const assetSymbol = typeof item.assetSymbol === 'string' ? item.assetSymbol.toUpperCase().trim() : '';
      const tokenContract = getCanonicalTokenContract(normNet);
      const isEvmDeposit = normNet === 'ETH' || normNet === 'ERC20' || normNet === 'BEP20';
      const isTronDeposit = normNet === 'TRC20';
      const expectedAsset = normNet === 'ETH' ? 'ETH'
        : normNet === 'ERC20' || normNet === 'BEP20' || normNet === 'TRC20' ? 'USDT'
        : '';
      const amountText = positiveDecimalText(item.value, 6);
      let verifiedAmount: string | null = null;

      const validTxHash = isEvmDeposit
        ? txHash.length === 66 && txHash.startsWith('0x') && /^[a-fA-F0-9]{64}$/.test(txHash.slice(2))
        : isTronDeposit
          ? txHash.length === 64 && /^[a-fA-F0-9]{64}$/.test(txHash)
          : false;

      if (!destinationAddress || !validTxHash || !expectedAsset || assetSymbol !== expectedAsset) {
        processedResults.push({ txHash, status: 'error', error: 'Unsupported or invalid deposit identity' });
        continue;
      }

      if (isTronDeposit && !amountText) {
        processedResults.push({ txHash, status: 'error', error: 'TRC20 amount must be an exact decimal string' });
        continue;
      }

      // Token amounts and log indexes come from one unique canonical receipt log,
      // never from a floating-point indexer payload.
      if (normNet === 'ERC20' || normNet === 'BEP20') {
        try {
          if (!tokenContract || assetSymbol !== 'USDT') throw new Error('Canonical token contract or asset is invalid');
          const provider = getEvmProvider(normNet);
          const [transaction, receipt, providerNetwork] = await Promise.all([
            provider.getTransaction(txHash),
            provider.getTransactionReceipt(txHash),
            provider.getNetwork(),
          ]);
          const expectedChainId = normNet === 'BEP20' ? 56n : 1n;
          if (!transaction || !receipt || receipt.status !== 1 ||
              providerNetwork.chainId !== expectedChainId ||
              (transaction.chainId != null && transaction.chainId !== expectedChainId) ||
              typeof transaction.to !== 'string' || transaction.to.toLowerCase() !== tokenContract.toLowerCase() ||
              receipt.hash.toLowerCase() !== txHash.toLowerCase()) throw new Error('On-chain receipt or transaction does not match');
          const evidence = resolveUniqueEvmTransferEvidence({
            receipt, txHash, tokenContract, destinationAddress,
            decimals: normNet === 'ERC20' ? 6 : 18,
          });
          if (!evidence) throw new Error('No unique matching Transfer log');
          outputIndex = evidence.index;
          verifiedAmount = evidence.amount;
        } catch {
          processedResults.push({ txHash, status: 'error', error: 'Unable to verify unique on-chain token log and amount' });
          continue;
        }
      } else if (normNet === 'ETH') {
        try {
          const provider = getEvmProvider('ETH');
          const [transaction, receipt, providerNetwork] = await Promise.all([
            provider.getTransaction(txHash),
            provider.getTransactionReceipt(txHash),
            provider.getNetwork(),
          ]);
          if (providerNetwork.chainId !== 1n || !transaction || !receipt || receipt.status !== 1 ||
              receipt.hash.toLowerCase() !== txHash.toLowerCase() ||
              !transaction.to || transaction.to.toLowerCase() !== destinationAddress.toLowerCase() ||
              transaction.value <= 0n || assetSymbol !== 'ETH') throw new Error('Native transfer evidence mismatch');
          verifiedAmount = ethers.formatUnits(transaction.value, 18);
          outputIndex = 0;
        } catch {
          processedResults.push({ txHash, status: 'error', error: 'Unable to verify native chain transfer and amount' });
          continue;
        }
      } else if (normNet === 'TRC20') {
        // TRON ingress records only a pending candidate. The confirmation worker
        // re-queries the transaction and validates the exact Transfer event/index.
        if (!Number.isSafeInteger(outputIndex) || (outputIndex as number) < 0 || !tokenContract) {
          processedResults.push({ txHash, status: 'error', error: 'Missing TRC20 event index or canonical token contract' });
          continue;
        }
        verifiedAmount = amountText;
      }

      if (!verifiedAmount) {
        processedResults.push({ txHash, status: 'error', error: 'Exact verified deposit amount is unavailable' });
        continue;
      }

      if (!Number.isSafeInteger(outputIndex) || (outputIndex as number) < 0) {
        processedResults.push({ txHash, status: 'error', error: 'Missing or invalid output/event index; deposit not registered' });
        continue;
      }

      // Delegate pending registration only; chain verification worker controls credit.
      const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('register_pending_deposit', {
        p_destination_address: destinationAddress,
        p_asset_symbol: assetSymbol,
        p_network_code: normNet,
        p_amount: verifiedAmount,
        p_tx_hash: txHash,
        p_output_index: outputIndex,
        p_block_number: item.blockNumber ?? null,
        p_from_address: item.from || null,
        p_token_contract: tokenContract,
        p_confirmations: 0, // Webhook payloads are not authoritative confirmation evidence; worker re-verifies chain state.
        p_provider: 'deposit_webhook',
      });

      if (rpcErr) {
        console.error(`[Deposit Webhook] RPC error for tx ${txHash}:`, rpcErr.message);
        processedResults.push({
          txHash,
          logIndex: outputIndex,
          status: 'error',
          error: rpcErr.message,
        });
      } else {
        const parsed = typeof rpcData === 'string' ? JSON.parse(rpcData) : rpcData;
        processedResults.push({
          txHash,
          logIndex: outputIndex,
          status: parsed?.status || (parsed?.already_processed ? 'already_processed' : 'success'),
          result: parsed,
        });
      }
    }

    return NextResponse.json({
      success: true,
      processed: processedResults.length,
      results: processedResults,
    });
  } catch (error: any) {
    console.error('❌ [Deposit Webhook] Error processing event:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error processing deposit webhook' },
      { status: 500 }
    );
  }
}
