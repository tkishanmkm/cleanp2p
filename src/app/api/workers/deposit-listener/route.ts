import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { ethers } from 'ethers';
import { normalizeDepositNetwork } from '@/lib/hd-derivation-engine';
import { CANONICAL_USDT_CONTRACTS } from '@/jobs/depositIngestion';

// Standard ERC-20 transfer method signature: transfer(address,uint256)
const ERC20_TRANSFER_METHOD_ID = '0xa9059cbb';

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
      if (b) targetBlockNumber = parseInt(b, 10);
    } else {
      const body = await req.json().catch(() => ({}));
      if (body.block || body.blockNumber) {
        targetBlockNumber = parseInt(body.block || body.blockNumber, 10);
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

    const evmAddressMap = new Map<string, { assetCode: string; networkCode: string }>();

    for (const record of addressRecords || []) {
      if (record.address && record.address.startsWith('0x')) {
        evmAddressMap.set(record.address.toLowerCase().trim(), {
          assetCode: record.asset_code || 'USDT',
          networkCode: record.network_code || 'ERC20',
        });
      }
    }

    const rpcUrl = process.env.EVM_RPC_URL || 'https://cloudflare-eth.com';
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    let scannedBlockNumber: number;
    try {
      if (targetBlockNumber && !isNaN(targetBlockNumber) && targetBlockNumber > 0) {
        scannedBlockNumber = targetBlockNumber;
      } else {
        scannedBlockNumber = await provider.getBlockNumber();
      }
    } catch (rpcErr: any) {
      return NextResponse.json(
        { error: `RPC connection error while getting block number: ${rpcErr.message}` },
        { status: 500 }
      );
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
      if (txTo && evmAddressMap.has(txTo) && tx.value > BigInt(0)) {
        const formattedAmount = parseFloat(ethers.formatEther(tx.value));
        if (formattedAmount > 0) {
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

      // ERC-20 Transfer
      if (txData && txData.startsWith(ERC20_TRANSFER_METHOD_ID) && txData.length >= 138) {
        try {
          const recipientPadded = txData.slice(10, 74);
          const rawRecipient = '0x' + recipientPadded.slice(24).toLowerCase();
          const amountHex = '0x' + txData.slice(74, 138);
          const rawAmount = BigInt(amountHex);

          if (evmAddressMap.has(rawRecipient) && rawAmount > BigInt(0)) {
            const addrConfig = evmAddressMap.get(rawRecipient)!;
            const normNet = normalizeDepositNetwork(addrConfig.networkCode);
            const decimals = normNet === 'ERC20' ? 6 : 18;
            const formattedAmount = parseFloat(ethers.formatUnits(rawAmount, decimals));
            const tokenContract = CANONICAL_USDT_CONTRACTS[normNet] || txTo;

            if (formattedAmount > 0) {
              matchedDeposits.push({
                txHash: tx.hash,
                fromAddress: tx.from?.toLowerCase(),
                toAddress: rawRecipient,
                amount: formattedAmount,
                asset: 'USDT',
                network: normNet,
                tokenContract,
                outputIndex: 0,
                blockNumber: scannedBlockNumber,
              });
            }
          }
        } catch (parseErr) {
          console.warn(`Failed to parse ERC20 transfer data for tx ${tx.hash}:`, parseErr);
        }
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
          p_confirmations: 12,
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
