import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { ethers } from 'ethers';
import { normalizeDepositNetwork } from '@/lib/hd-derivation-engine';
import { CANONICAL_USDT_CONTRACTS } from '@/jobs/depositIngestion';

// Canonical ERC-20 Transfer event signature.
const ERC20_TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)').toLowerCase();

interface ScannedDepositMatch {
  txHash: string;
  fromAddress?: string;
  toAddress: string;
  amount: number;
  asset: string;
  network: string;
  tokenContract: string | null;
  outputIndex: number;
  blockNumber: number;
}

function isAuthorized(req: NextRequest): boolean {
  const serviceKey = process.env.PROVISION_SERVICE_KEY;
  if (!serviceKey) {
    console.error("PROVISION_SERVICE_KEY environment variable is not configured.");
    return false;
  }

  const headerKey = req.headers.get('x-service-key') || req.headers.get('x-provision-key');
  if (headerKey && headerKey === serviceKey) {
    return true;
  }

  const authHeader = req.headers.get('authorization');
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token === serviceKey) {
      return true;
    }
  }

  return false;
}

async function processDepositWorker(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { error: 'Unauthorized: Invalid or missing service key.' },
        { status: 401 }
      );
    }

    let targetBlockNumber: number | null = null;
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const b = url.searchParams.get('block') || url.searchParams.get('blockNumber');
      if (b !== null) targetBlockNumber = Number(b);
    } else {
      const body = await req.json().catch(() => ({}));
      if (body.block !== undefined || body.blockNumber !== undefined) {
        targetBlockNumber = Number(body.block ?? body.blockNumber);
      }
    }

    const supabaseAdmin = getSupabaseAdminClient();

    // Read all active EVM deposit addresses
    const { data: addressRecords, error: addressError } = await supabaseAdmin
      .from('deposit_addresses')
      .select('id, address, asset_code, network_code');

    if (addressError) {
      return NextResponse.json(
        { error: `Database error querying deposit addresses: ${addressError.message}` },
        { status: 500 }
      );
    }

    const rpcUrl = process.env.EVM_RPC_URL || 'https://cloudflare-eth.com';
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    let chainId: bigint;
    try {
      chainId = (await provider.getNetwork()).chainId;
    } catch (rpcErr: any) {
      return NextResponse.json(
        { error: 'RPC connection error while identifying the EVM chain.' },
        { status: 503 }
      );
    }

    // This worker scans one chain per invocation. Never interpret a block from one
    // EVM chain as deposits on another chain.
    const chainNetwork = chainId === 1n ? 'ETH' : chainId === 56n ? 'BEP20' : null;
    if (!chainNetwork) {
      return NextResponse.json(
        { error: 'Unsupported EVM RPC chain; configure an Ethereum mainnet or BNB Smart Chain RPC.' },
        { status: 503 }
      );
    }

    const evmAddressMap = new Map<string, Array<{ assetCode: string; networkCode: string }>>();
    for (const record of addressRecords || []) {
      if (record.address && record.address.startsWith('0x')) {
        const key = record.address.toLowerCase().trim();
        const configs = evmAddressMap.get(key) || [];
        configs.push({
          assetCode: String(record.asset_code || '').toUpperCase(),
          networkCode: normalizeDepositNetwork(String(record.network_code || '')),
        });
        evmAddressMap.set(key, configs);
      }
    }

    let scannedBlockNumber: number;
    let latestBlockNumber: number;
    try {
      latestBlockNumber = await provider.getBlockNumber();
      if (targetBlockNumber !== null) {
        if (!Number.isSafeInteger(targetBlockNumber) || targetBlockNumber < 1) {
          return NextResponse.json({ error: 'Block number must be a positive safe integer.' }, { status: 400 });
        }
        if (targetBlockNumber > latestBlockNumber) {
          return NextResponse.json({ error: 'Requested block is ahead of the current chain head.' }, { status: 400 });
        }
        scannedBlockNumber = targetBlockNumber;
      } else {
        scannedBlockNumber = latestBlockNumber;
      }
    } catch (rpcErr: any) {
      return NextResponse.json(
        { error: 'RPC connection error while getting block number.' },
        { status: 503 }
      );
    }

    // Only report confirmations actually observed from this RPC. Never submit a
    // fixed confirmation count for a freshly mined block.
    const observedConfirmations = latestBlockNumber - scannedBlockNumber + 1;
    if (!Number.isSafeInteger(observedConfirmations) || observedConfirmations < 1) {
      return NextResponse.json({ error: 'Unable to establish a valid confirmation count.' }, { status: 503 });
    }

    let block: ethers.Block | null = null;
    try {
      block = await provider.getBlock(scannedBlockNumber, true);
    } catch (rpcErr: any) {
      return NextResponse.json(
        { error: `RPC error retrieving block ${scannedBlockNumber}: ${rpcErr.message}` },
        { status: 500 }
      );
    }

    if (!block) {
      return NextResponse.json({
        success: true,
        credited_count: 0,
        scanned_block: scannedBlockNumber,
        message: `Block ${scannedBlockNumber} not found on chain.`,
      });
    }

    const matchedDeposits: ScannedDepositMatch[] = [];
    const transactions = (block.prefetchedTransactions && block.prefetchedTransactions.length > 0)
      ? block.prefetchedTransactions
      : [];

    for (const tx of transactions) {
      if (!tx || !tx.hash) continue;

      const txTo = tx.to ? tx.to.toLowerCase() : null;
      const txData = tx.data || '0x';

      // Native Transfer (ETH)
      const nativeRecipientConfigs = txTo ? evmAddressMap.get(txTo) || [] : [];
      if (
        txTo &&
        chainNetwork === 'ETH' &&
        nativeRecipientConfigs.some((config) => config.networkCode === 'ETH' && config.assetCode === 'ETH') &&
        tx.value > BigInt(0)
      ) {
        const formattedAmount = parseFloat(ethers.formatEther(tx.value));
        if (Number.isFinite(formattedAmount) && formattedAmount > 0) {
          matchedDeposits.push({
            txHash: tx.hash,
            fromAddress: tx.from?.toLowerCase(),
            toAddress: txTo,
            amount: formattedAmount,
            asset: 'ETH',
            network: 'ETH',
            tokenContract: null,
            outputIndex: 0,
            blockNumber: scannedBlockNumber,
          });
          continue;
        }
      }

      // ERC-20 deposits are identified from mined receipt logs, not calldata.
      // This also covers transferFrom/router calls and gives each transfer a unique log index.
      const expectedTokenNetwork = chainNetwork === 'ETH' ? 'ERC20' : 'BEP20';
      const expectedContract = CANONICAL_USDT_CONTRACTS[expectedTokenNetwork]?.toLowerCase();
      if (!expectedContract) continue;

      if (txTo !== expectedContract) continue;

      try {
        const receipt = await provider.getTransactionReceipt(tx.hash);
        if (!receipt || receipt.status !== 1) continue;

        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== expectedContract) continue;
          if (!log.topics[0] || log.topics[0].toLowerCase() !== ERC20_TRANSFER_TOPIC) continue;
          if (log.topics.length < 3 || !/^0x[0-9a-fA-F]{64}$/.test(log.topics[1]) ||
              !/^0x[0-9a-fA-F]{64}$/.test(log.topics[2])) continue;

          const rawRecipient = ('0x' + log.topics[2].slice(-40)).toLowerCase();
          const addrConfig = (evmAddressMap.get(rawRecipient) || []).find(
            (config) => config.networkCode === expectedTokenNetwork && config.assetCode === 'USDT'
          );
          if (!addrConfig || !/^0x[0-9a-fA-F]{64}$/.test(log.data)) continue;

          const rawAmount = BigInt(log.data);
          if (rawAmount <= 0n) continue;

          const decimals = expectedTokenNetwork === 'ERC20' ? 6 : 18;
          const formattedAmount = Number(ethers.formatUnits(rawAmount, decimals));
          if (!Number.isFinite(formattedAmount) || formattedAmount <= 0) continue;

          matchedDeposits.push({
            txHash: tx.hash,
            fromAddress: ('0x' + log.topics[1].slice(-40)).toLowerCase(),
            toAddress: rawRecipient,
            amount: formattedAmount,
            asset: 'USDT',
            network: expectedTokenNetwork,
            tokenContract: expectedContract,
            outputIndex: log.index,
            blockNumber: scannedBlockNumber,
          });
        }
      } catch (parseErr) {
        console.warn(`Failed to inspect ERC-20 receipt logs for tx ${tx.hash}.`, parseErr);
      }
    }

    let creditedCount = 0;

    for (const match of matchedDeposits) {
      try {
        const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('process_deposit_atomic', {
          p_destination_address: match.toAddress,
          p_asset_symbol: match.asset,
          p_network_code: match.network,
          p_amount: match.amount,
          p_tx_hash: match.txHash,
          p_output_index: match.outputIndex,
          p_block_number: match.blockNumber,
          p_from_address: match.fromAddress || null,
          p_token_contract: match.tokenContract,
          p_confirmations: observedConfirmations,
          p_provider: 'deposit_listener_worker',
        });

        if (!rpcErr) {
          const parsed = typeof rpcData === 'string' ? JSON.parse(rpcData) : rpcData;
          if (parsed?.status === 'credited') creditedCount++;
        }
      } catch (depositProcessingErr) {
        console.error(`Error processing deposit for tx ${match.txHash}:`, depositProcessingErr);
      }
    }

    return NextResponse.json({
      success: true,
      credited_count: creditedCount,
      scanned_block: scannedBlockNumber,
      total_transactions: transactions.length,
      matched_deposits: matchedDeposits.length,
    }, { status: 200 });

  } catch (err: any) {
    console.error("Deposit listener worker unhandled error:", err);
    return NextResponse.json(
      { error: err?.message || 'An unexpected error occurred in deposit listener worker.' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return processDepositWorker(req);
}

export async function POST(req: NextRequest) {
  return processDepositWorker(req);
}
