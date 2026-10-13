import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { verifyHmacSha256 } from '@/lib/webhooks/auth';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { normalizeDepositNetwork } from '@/lib/hd-derivation-engine';
import { CANONICAL_USDT_CONTRACTS } from '@/jobs/depositIngestion';

export const dynamic = 'force-dynamic';

function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret =
    process.env.BLOCKCHAIN_WEBHOOK_SECRET ||
    process.env.ALCHEMY_WEBHOOK_SIGNING_KEY ||
    process.env.CHAIN_INGEST_SECRET;
  return verifyHmacSha256(rawBody, signatureHeader, secret);
}

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
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
    const ingestBuffer = Buffer.from(ingestHeader || '', 'utf8');
    const secretBuffer = Buffer.from(secret, 'utf8');
    const isDirectHeaderValid = Boolean(ingestHeader) && ingestBuffer.length > 0 && ingestBuffer.length === secretBuffer.length && crypto.timingSafeEqual(ingestBuffer, secretBuffer);

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
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdminClient();

    // Standardize event items across providers
    const items: Array<{
      txHash: string;
      logIndex: number;
      from?: string;
      to: string;
      value: string | number;
      assetSymbol: string;
      network: string;
      confirmations?: number;
      blockNumber?: number;
    }> = [];

    if (Array.isArray(payload.events)) {
      for (const ev of payload.events) {
        items.push({
          txHash: ev.txHash || ev.hash || ev.transactionHash,
          logIndex: typeof ev.logIndex === 'number' && Number.isInteger(ev.logIndex) && ev.logIndex >= 0 ? ev.logIndex : -1,
          from: ev.from || ev.fromAddress,
          to: ev.to || ev.toAddress,
          value: ev.value || ev.amount,
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
          logIndex: Number.isInteger(act.logIndex) && act.logIndex >= 0 ? act.logIndex : -1,
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
        logIndex: typeof payload.logIndex === 'number' && Number.isInteger(payload.logIndex) && payload.logIndex >= 0 ? payload.logIndex : -1,
        from: payload.from || payload.fromAddress,
        to: payload.to || payload.toAddress,
        value: payload.value || payload.amount,
        assetSymbol: (payload.assetSymbol || payload.symbol || 'USDT').toUpperCase(),
        network: (payload.network || 'ERC20'),
        confirmations: payload.confirmations,
        blockNumber: payload.blockNumber ? parseInt(payload.blockNumber, 10) : undefined,
      });
    }

    if (items.length === 0) {
      return NextResponse.json({ message: 'No transferable log items detected' }, { status: 200 });
    }

    const processedResults = [];

    for (const item of items) {
      const destinationAddress = item.to?.trim();
      const txHash = item.txHash;
      const logIndex = item.logIndex;
      const amount = typeof item.value === 'number' ? item.value : parseFloat(item.value);
      const normNet = normalizeDepositNetwork(item.network);
      const assetSymbol = (item.assetSymbol || 'USDT').toUpperCase().trim();
      const tokenContract = CANONICAL_USDT_CONTRACTS[normNet] || null;

      if (!destinationAddress || !txHash || !/^(0x)?[a-f0-9]{64}$/i.test(txHash) || !Number.isInteger(logIndex) || logIndex < 0 || !Number.isFinite(amount) || amount <= 0) {
        continue;
      }

      // Delegate credit and recording atomically to canonical process_deposit_atomic RPC
      const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('process_deposit_atomic', {
        p_destination_address: destinationAddress,
        p_asset_symbol: assetSymbol,
        p_network_code: normNet,
        p_amount: amount,
        p_tx_hash: txHash,
        p_output_index: logIndex,
        p_block_number: item.blockNumber ?? null,
        p_from_address: item.from || null,
        p_token_contract: tokenContract,
        // Provider-reported confirmations are not independently verified here.
        p_confirmations: 0,
        p_provider: 'deposit_webhook',
      });

      if (rpcErr) {
        console.error('[Deposit Webhook] Canonical deposit RPC failed');
        processedResults.push({
          txHash,
          logIndex,
          status: 'error',
          error: 'Deposit processing failed',
        });
      } else {
        const parsed = typeof rpcData === 'string' ? JSON.parse(rpcData) : rpcData;
        processedResults.push({
          txHash,
          logIndex,
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
  } catch {
    console.error('[Deposit Webhook] Error processing event');
    return NextResponse.json(
      { error: 'Internal server error processing deposit webhook' },
      { status: 500 }
    );
  }
}
