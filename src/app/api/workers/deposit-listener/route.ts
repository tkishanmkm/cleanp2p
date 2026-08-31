import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { ethers } from 'ethers';

// Standard ERC-20 transfer method signature: transfer(address,uint256)
const ERC20_TRANSFER_METHOD_ID = '0xa9059cbb';

interface ScannedDepositMatch {
  txHash: string;
  fromAddress?: string;
  toAddress: string;
  amount: number;
  asset: string;
  userId: string;
  walletId?: string;
  blockNumber: number;
  rawTx: any;
}

/**
 * Validates request authentication against PROVISION_SERVICE_KEY
 */
function isAuthorized(req: NextRequest): boolean {
  const serviceKey = process.env.PROVISION_SERVICE_KEY;
  if (!serviceKey) {
    // If not configured in environment, fail securely
    console.error("PROVISION_SERVICE_KEY environment variable is not configured.");
    return false;
  }

  // 1. Check x-service-key header
  const headerKey = req.headers.get('x-service-key') || req.headers.get('x-provision-key');
  if (headerKey && headerKey === serviceKey) {
    return true;
  }

  // 2. Check Authorization Bearer header
  const authHeader = req.headers.get('authorization');
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token === serviceKey) {
      return true;
    }
  }

  return false;
}

/**
 * Fallback direct credit logic if the SQL stored procedure is not provisioned on Supabase yet
 */
async function fallbackCreditWallet(
  supabaseAdmin: any,
  userId: string,
  amount: number,
  txHash: string,
  asset: string,
  walletId?: string
) {
  const assetCode = (asset || 'USDT').toUpperCase().trim();

  // 1. Resolve or create user's wallet container
  let resolvedWalletId = walletId;
  if (!resolvedWalletId) {
    const { data: wallet } = await supabaseAdmin
      .from('wallets')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (wallet?.id) {
      resolvedWalletId = wallet.id;
    } else {
      const { data: newWallet } = await supabaseAdmin
        .from('wallets')
        .insert({
          user_id: userId,
          status: 'active',
          provisioning_status: 'completed',
        })
        .select('id')
        .single();
      resolvedWalletId = newWallet?.id;
    }
  }

  if (!resolvedWalletId) {
    throw new Error(`Failed to resolve wallet container for user ${userId}`);
  }

  // 2. Fetch or create wallet_assets record
  const { data: currentAsset } = await supabaseAdmin
    .from('wallet_assets')
    .select('available, locked_escrow, locked_withdrawal')
    .eq('wallet_id', resolvedWalletId)
    .eq('asset_code', assetCode)
    .maybeSingle();

  const currentAvailable = Number(currentAsset?.available || 0);
  const currentLocked = Number(currentAsset?.locked_escrow || 0) + Number(currentAsset?.locked_withdrawal || 0);
  const newAvailable = currentAvailable + amount;

  if (!currentAsset) {
    await supabaseAdmin.from('wallet_assets').insert({
      wallet_id: resolvedWalletId,
      asset_code: assetCode,
      available: amount,
      locked_escrow: 0,
      locked_withdrawal: 0,
    });
  } else {
    await supabaseAdmin
      .from('wallet_assets')
      .update({
        available: newAvailable,
        updated_at: new Date().toISOString(),
      })
      .eq('wallet_id', resolvedWalletId)
      .eq('asset_code', assetCode);
  }

  // 3. Insert into ledger_entries
  const idempotencyKey = `dep_auto_${txHash}_${assetCode}`;
  await supabaseAdmin
    .from('ledger_entries')
    .insert({
      wallet_id: resolvedWalletId,
      user_id: userId,
      asset_code: assetCode,
      delta_available: amount,
      delta_locked: 0,
      available_after: newAvailable,
      locked_after: currentLocked,
      entry_type: 'deposit_credit',
      ref_table: 'processed_deposits',
      ref_id: txHash,
      idempotency_key: idempotencyKey,
    })
    .catch((err: any) => console.warn("Ledger entry warning:", err.message));

  // 4. Update deposits table
  await supabaseAdmin
    .from('deposits')
    .upsert({
      user_id: userId,
      wallet_id: resolvedWalletId,
      asset_code: assetCode,
      network_code: 'EVM',
      amount: amount,
      txid: txHash,
      confirmations: 12,
      status: 'credited',
      credited_at: new Date().toISOString(),
      idempotency_key: `dep_table_${idempotencyKey}`,
    }, { onConflict: 'idempotency_key' })
    .catch((err: any) => console.warn("Deposits table upsert warning:", err.message));
}

async function processDepositWorker(req: NextRequest) {
  try {
    // 1. SECURITY & AUTHENTICATION
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { error: 'Unauthorized: Invalid or missing service key.' },
        { status: 401 }
      );
    }

    // Optional query/body parameters for block targeting or backfilling
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

    // 2. MONITORED CHAINS: Read all active EVM deposit addresses
    const { data: addressRecords, error: addressError } = await supabaseAdmin
      .from('deposit_addresses')
      .select('id, wallet_id, user_id, asset_code, network_code, address, status')
      .eq('status', 'active');

    if (addressError) {
      console.error("Failed to fetch deposit addresses from Supabase:", addressError.message);
      return NextResponse.json(
        { error: `Database error querying deposit addresses: ${addressError.message}` },
        { status: 500 }
      );
    }

    // Filter and map EVM addresses (addresses starting with 0x)
    const evmAddressMap = new Map<string, {
      userId: string;
      walletId?: string;
      assetCode: string;
      networkCode: string;
    }>();

    for (const record of addressRecords || []) {
      if (record.address && record.address.startsWith('0x')) {
        evmAddressMap.set(record.address.toLowerCase().trim(), {
          userId: record.user_id,
          walletId: record.wallet_id,
          assetCode: record.asset_code || 'USDT',
          networkCode: record.network_code || 'EVM',
        });
      }
    }

    // 3. EVM / BSC RPC PROVIDER
    const rpcUrl = process.env.EVM_RPC_URL || 'https://bsc-dataseed.binance.org';
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    // Fetch latest block number if not specified
    let scannedBlockNumber: number;
    try {
      if (targetBlockNumber && !isNaN(targetBlockNumber) && targetBlockNumber > 0) {
        scannedBlockNumber = targetBlockNumber;
      } else {
        scannedBlockNumber = await provider.getBlockNumber();
      }
    } catch (rpcErr: any) {
      console.error("RPC block number fetch failed:", rpcErr);
      return NextResponse.json(
        { error: `RPC connection error while getting block number: ${rpcErr.message}` },
        { status: 500 }
      );
    }

    // Fetch block with transactions
    let block: ethers.Block | null = null;
    try {
      block = await provider.getBlock(scannedBlockNumber, true);
    } catch (rpcErr: any) {
      console.error(`RPC getBlock(${scannedBlockNumber}) failed:`, rpcErr);
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

    // 4. BLOCK SCANNING: Iterate transactions in the block
    const matchedDeposits: ScannedDepositMatch[] = [];

    // In ethers v6, block.prefetchedTransactions contains TransactionResponse[]
    const transactions = (block.prefetchedTransactions && block.prefetchedTransactions.length > 0)
      ? block.prefetchedTransactions
      : [];

    for (const tx of transactions) {
      if (!tx || !tx.hash) continue;

      const txTo = tx.to ? tx.to.toLowerCase() : null;
      const txData = tx.data || '0x';

      // Check A: Native Transfer (ETH / BNB)
      if (txTo && evmAddressMap.has(txTo) && tx.value > 0n) {
        const addrConfig = evmAddressMap.get(txTo)!;
        const formattedAmount = parseFloat(ethers.formatEther(tx.value));
        if (formattedAmount > 0) {
          matchedDeposits.push({
            txHash: tx.hash,
            fromAddress: tx.from,
            toAddress: txTo,
            amount: formattedAmount,
            asset: addrConfig.assetCode === 'USDT' || addrConfig.assetCode === 'USDC' ? 'BNB' : addrConfig.assetCode,
            userId: addrConfig.userId,
            walletId: addrConfig.walletId,
            blockNumber: scannedBlockNumber,
            rawTx: {
              value: tx.value.toString(),
              type: 'native',
            },
          });
          continue;
        }
      }

      // Check B: ERC-20 / BEP-20 transfer(address _to, uint256 _value)
      if (txData && txData.startsWith(ERC20_TRANSFER_METHOD_ID) && txData.length >= 138) {
        try {
          // Method parameters: address (32 bytes padded), uint256 (32 bytes)
          const recipientPadded = txData.slice(10, 74);
          const rawRecipient = '0x' + recipientPadded.slice(24).toLowerCase();
          const amountHex = '0x' + txData.slice(74, 138);
          const rawAmount = BigInt(amountHex);

          if (evmAddressMap.has(rawRecipient) && rawAmount > 0n) {
            const addrConfig = evmAddressMap.get(rawRecipient)!;
            // Most stablecoins USDT/USDC use 18 decimals on BSC/BEP20 or 6 on Ethereum ERC20
            const decimals = addrConfig.networkCode === 'ERC20' && (addrConfig.assetCode === 'USDT' || addrConfig.assetCode === 'USDC') ? 6 : 18;
            const formattedAmount = parseFloat(ethers.formatUnits(rawAmount, decimals));

            if (formattedAmount > 0) {
              matchedDeposits.push({
                txHash: tx.hash,
                fromAddress: tx.from,
                toAddress: rawRecipient,
                amount: formattedAmount,
                asset: addrConfig.assetCode,
                userId: addrConfig.userId,
                walletId: addrConfig.walletId,
                blockNumber: scannedBlockNumber,
                rawTx: {
                  contract: txTo,
                  rawAmount: rawAmount.toString(),
                  type: 'erc20',
                },
              });
            }
          }
        } catch (parseErr) {
          console.warn(`Failed to parse ERC20 transfer data for tx ${tx.hash}:`, parseErr);
        }
      }
    }

    // 5. PROCESS MATCHED TRANSACTIONS
    let creditedCount = 0;

    for (const match of matchedDeposits) {
      try {
        // a. Query processed_deposits to prevent double-crediting
        const { data: existingProcessed, error: queryProcessedError } = await supabaseAdmin
          .from('processed_deposits')
          .select('id, status')
          .eq('tx_hash', match.txHash)
          .maybeSingle();

        if (queryProcessedError && queryProcessedError.code !== 'PGRST116') {
          console.warn(`Query processed_deposits warning for ${match.txHash}:`, queryProcessedError.message);
        }

        if (existingProcessed) {
          // Already processed, skip to prevent double crediting
          continue;
        }

        // b. Call Supabase RPC stored procedure credit_user_deposit
        let rpcSuccessful = false;
        try {
          const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc('credit_user_deposit', {
            p_user_id: match.userId,
            p_amount: match.amount,
            p_tx_hash: match.txHash,
            p_asset: match.asset,
          });

          if (!rpcError && rpcResult?.success) {
            rpcSuccessful = true;
          } else if (rpcError) {
            console.warn(`credit_user_deposit RPC failed (${rpcError.message}), falling back to direct credit...`);
          }
        } catch (rpcCallErr) {
          console.warn("credit_user_deposit RPC invocation exception, falling back:", rpcCallErr);
        }

        // Fallback if stored procedure was not yet executed in database
        if (!rpcSuccessful) {
          await fallbackCreditWallet(
            supabaseAdmin,
            match.userId,
            match.amount,
            match.txHash,
            match.asset,
            match.walletId
          );
        }

        // c. Insert record into processed_deposits
        const { error: insertProcessedError } = await supabaseAdmin
          .from('processed_deposits')
          .insert({
            tx_hash: match.txHash,
            user_id: match.userId,
            amount: match.amount,
            chain: 'EVM',
            asset: match.asset,
            status: 'COMPLETED',
            block_number: match.blockNumber,
            metadata: {
              toAddress: match.toAddress,
              fromAddress: match.fromAddress,
              rawTx: match.rawTx,
              processedAt: new Date().toISOString(),
            },
          });

        if (insertProcessedError) {
          console.error(`Failed to insert into processed_deposits for tx ${match.txHash}:`, insertProcessedError.message);
        }

        creditedCount++;
      } catch (depositProcessingErr) {
        console.error(`Error processing deposit for tx ${match.txHash}:`, depositProcessingErr);
      }
    }

    // 6. RETURN SUCCESS RESPONSE
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
