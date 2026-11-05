import { NextRequest, NextResponse } from 'next/server';
import { SYSTEM_CONFIG } from '@/lib/config/env';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { normalizeDepositNetwork } from '@/lib/hd-derivation-engine';
import { CANONICAL_USDT_CONTRACTS } from '@/jobs/depositIngestion';
import { getEvmProvider } from '@/lib/blockchain/providers';
import { resolveUniqueEvmTransferEvidence } from '@/lib/blockchain/resolve-evm-transfer-log-index';
import crypto from 'crypto';
import { ethers } from 'ethers';

const MAX_ALCHEMY_WEBHOOK_BYTES = 2 * 1024 * 1024;

async function readBoundedBody(req: Request): Promise<string | null> {
  const reader = req.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_ALCHEMY_WEBHOOK_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function verifySignature(body: string, signature: string, secret: string): boolean {
  try {
    if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
    const hmac = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const sigBuf = Buffer.from(signature, 'hex');
    const hmacBuf = Buffer.from(hmac, 'hex');
    if (sigBuf.length !== hmacBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, hmacBuf);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const rawBody = await readBoundedBody(req);
    if (rawBody === null) {
      return NextResponse.json({ error: 'Webhook payload is too large.' }, { status: 413 });
    }
    const signature = req.headers.get('x-alchemy-signature') ?? '';

    // This webhook can credit customer balances. Missing signature configuration must fail closed.
    if (!SYSTEM_CONFIG.secrets.webhook) {
      console.error('[Alchemy Webhook] Signing secret is not configured; rejecting webhook.');
      return NextResponse.json({ error: 'Webhook signing is not configured' }, { status: 500 });
    }
    if (!signature || !verifySignature(rawBody, signature, SYSTEM_CONFIG.secrets.webhook)) {
      return NextResponse.json({ error: 'Invalid HMAC signature' }, { status: 401 });
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const activities = payload.event?.activity;
    if (!Array.isArray(activities) || activities.length === 0) {
      return NextResponse.json({ error: 'No activity data found' }, { status: 400 });
    }
    if (activities.length > 100) {
      return NextResponse.json({ error: 'Too many activities in one webhook payload' }, { status: 413 });
    }

    const supabaseAdmin = getSupabaseAdminClient();
    const results: Array<{ txHash: string; status: string; data?: unknown; error?: string }> = [];

    for (const activity of activities) {
      const toAddress = typeof activity?.toAddress === 'string' ? activity.toAddress.toLowerCase().trim() : '';
      const txHash = typeof activity?.hash === 'string' ? activity.hash.trim() : '';
      const rawAsset = typeof activity?.asset === 'string' ? activity.asset.toUpperCase().trim() : '';
      const blockNumberText = typeof activity?.blockNum === 'string' ? activity.blockNum : '';
      const blockNumber = /^0x[0-9a-f]+$/i.test(blockNumberText)
        ? Number.parseInt(blockNumberText, 16)
        : null;

      if (!toAddress || !/^0x[a-fA-F0-9]{64}$/.test(txHash) || !Number.isSafeInteger(blockNumber)) {
        results.push({ txHash, status: 'error', error: 'Invalid activity identity or block number' });
        continue;
      }

      const normNet = rawAsset === 'ETH' ? 'ETH' : rawAsset === 'USDT' ? 'ERC20' : '';
      if (!normNet) {
        results.push({ txHash, status: 'error', error: 'Unsupported Alchemy deposit asset' });
        continue;
      }

      const assetSymbol = normNet === 'ETH' ? 'ETH' : 'USDT';
      const tokenContract = CANONICAL_USDT_CONTRACTS[normNet] || null;
      let outputIndex = 0;
      let verifiedAmount = '';

      try {
        const provider = getEvmProvider(normNet);
        const [transaction, receipt, providerNetwork] = await Promise.all([
          provider.getTransaction(txHash),
          provider.getTransactionReceipt(txHash),
          provider.getNetwork(),
        ]);
        const expectedChainId = 1n;
        if (providerNetwork.chainId !== expectedChainId || !transaction || !receipt ||
            receipt.status !== 1 || receipt.hash.toLowerCase() !== txHash.toLowerCase() ||
            (transaction.chainId != null && transaction.chainId !== expectedChainId) ||
            !transaction.from) {
          throw new Error('On-chain transaction, receipt, or chain identity mismatch');
        }

        if (normNet === 'ETH') {
          if (!transaction.to || transaction.to.toLowerCase() !== toAddress || transaction.value <= 0n) {
            throw new Error('Native transfer recipient/value mismatch');
          }
          verifiedAmount = ethers.formatUnits(transaction.value, 18);
        } else {
          if (!tokenContract || typeof transaction.to !== 'string' ||
              transaction.to.toLowerCase() !== tokenContract.toLowerCase()) {
            throw new Error('Token contract mismatch');
          }
          const evidence = resolveUniqueEvmTransferEvidence({
            receipt, txHash, tokenContract, destinationAddress: toAddress, decimals: 6,
          });
          if (!evidence) throw new Error('Could not uniquely match token transfer receipt log');
          outputIndex = evidence.index;
          verifiedAmount = evidence.amount;
        }

        const { data: rpcData, error: creditError } = await supabaseAdmin.rpc('register_pending_deposit', {
          p_destination_address: toAddress,
          p_asset_symbol: assetSymbol,
          p_network_code: normNet,
          p_amount: verifiedAmount,
          p_tx_hash: txHash,
          p_output_index: outputIndex,
          p_block_number: blockNumber,
          p_from_address: transaction.from.toLowerCase(),
          p_token_contract: tokenContract,
          p_confirmations: 0,
          p_provider: 'alchemy_webhook',
        });

        if (creditError) {
          results.push({ txHash, status: 'error', error: 'Pending deposit registration failed' });
        } else {
          results.push({ txHash, status: 'pending', data: rpcData });
        }
      } catch {
        results.push({ txHash, status: 'error', error: 'Independent on-chain verification failed' });
      }
    }

    return NextResponse.json({ success: results.every((result) => result.status === 'pending'), processed: results.length, results });
  } catch (err: any) {
    console.error('Webhook processing error:', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
