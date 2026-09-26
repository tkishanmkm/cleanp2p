import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { normalizeDepositNetwork } from '@/lib/hd-derivation-engine';
import { CANONICAL_USDT_CONTRACTS } from '@/jobs/depositIngestion';

interface IngestPayload {
  networkCode: string;
  txid: string;
  outputIndex?: number;
  toAddress: string;
  fromAddress?: string;
  assetCode: string;
  amount: string | number;
  blockHeight?: number;
  confirmations: number;
}

export async function POST(req: NextRequest) {
  try {
    // 1. Validate incoming secret header
    const providedSecret = req.headers.get('x-ingest-secret');
    const configuredSecret = process.env.CHAIN_INGEST_SECRET;

    if (!configuredSecret || providedSecret !== configuredSecret) {
      return NextResponse.json(
        { error: 'Unauthorized: Invalid or missing x-ingest-secret header.' },
        { status: 401 }
      );
    }

    // 2. Parse & Validate Payload
    const body: IngestPayload = await req.json().catch(() => ({}));
    const {
      networkCode,
      txid,
      outputIndex = 0,
      toAddress,
      fromAddress,
      assetCode,
      amount,
      blockHeight,
      confirmations = 0,
    } = body;

    if (!networkCode || !txid || !toAddress || !assetCode || amount === undefined || amount === null) {
      return NextResponse.json(
        { error: 'Bad Request: Missing required transaction parameters.' },
        { status: 400 }
      );
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return NextResponse.json(
        { error: 'Bad Request: Invalid transaction amount.' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdminClient();
    const normNet = normalizeDepositNetwork(networkCode);
    const normAsset = assetCode.toUpperCase().trim();
    const tokenContract = CANONICAL_USDT_CONTRACTS[normNet] || null;

    // 3. Delegate to canonical atomic RPC
    const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('process_deposit_atomic', {
      p_destination_address: toAddress.trim(),
      p_asset_symbol: normAsset,
      p_network_code: normNet,
      p_amount: numAmount,
      p_tx_hash: txid.trim(),
      p_output_index: Number(outputIndex) || 0,
      p_block_number: blockHeight || null,
      p_from_address: fromAddress ? fromAddress.trim() : null,
      p_token_contract: tokenContract,
      p_confirmations: Number(confirmations) || 0,
      p_provider: 'chain_ingest_internal',
    });

    if (rpcErr) {
      console.error('[Chain Ingest] Canonical RPC failed:', rpcErr.message);
      return NextResponse.json(
        { error: `Canonical deposit error: ${rpcErr.message}` },
        { status: 500 }
      );
    }

    const parsed = typeof rpcData === 'string' ? JSON.parse(rpcData) : rpcData;

    return NextResponse.json({
      success: true,
      result: parsed,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error.';
    return NextResponse.json(
      { error: `Internal Server Error: ${message}` },
      { status: 500 }
    );
  }
}
