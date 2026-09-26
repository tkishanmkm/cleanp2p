import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { normalizeDepositNetwork } from '@/lib/hd-derivation-engine';
import { CANONICAL_USDT_CONTRACTS } from '@/jobs/depositIngestion';

export const dynamic = 'force-dynamic';

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
    const isDirectHeaderValid = ingestHeader && secret && crypto.timingSafeEqual(Buffer.from(ingestHeader), Buffer.from(secret));

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
          logIndex: typeof ev.logIndex === 'number' ? ev.logIndex : parseInt(ev.logIndex || '0', 10) || 0,
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
          logIndex: 0,
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
        logIndex: typeof payload.logIndex === 'number' ? payload.logIndex : 0,
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

      if (!destinationAddress || !txHash || isNaN(amount) || amount <= 0) {
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
        p_confirmations: item.confirmations ?? 12,
        p_provider: 'deposit_webhook',
      });

      if (rpcErr) {
        console.error(`[Deposit Webhook] RPC error for tx ${txHash}:`, rpcErr.message);
        processedResults.push({
          txHash,
          logIndex,
          status: 'error',
          error: rpcErr.message,
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
  } catch (error: any) {
    console.error('❌ [Deposit Webhook] Error processing event:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error processing deposit webhook' },
      { status: 500 }
    );
  }
}
