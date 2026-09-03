import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase admin client with service role key
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export interface WebhookPayload {
  txHash: string;
  network: 'TRC20' | 'ERC20' | 'BEP20' | 'POLYGON' | string;
  toAddress: string;
  fromAddress?: string;
  amount: string | number; // e.g. "100.50"
  assetSymbol: string; // e.g. "USDT"
  confirmations: number;
  blockNumber?: number;
}

/**
 * Maps blockchain network identifiers to their required confirmation thresholds
 */
export function getRequiredConfirmations(network: string): number {
  const norm = network.toUpperCase().trim();
  switch (norm) {
    case 'TRC20':
    case 'TRON':
      return 19;
    case 'ERC20':
    case 'ETHEREUM':
      return 12;
    case 'BEP20':
    case 'BSC':
    case 'BINANCE':
      return 15;
    case 'POLYGON':
    case 'MATIC':
      return 128;
    case 'BITCOIN':
    case 'BTC':
      return 2;
    default:
      return 12;
  }
}

/**
 * Fallback direct credit logic if RPC stored procedure is pending migration
 */
async function fallbackCreditConfirmedDeposit(
  userId: string,
  amount: number,
  txHash: string,
  assetSymbol: string,
  network: string
) {
  const assetCode = assetSymbol.toUpperCase().trim();

  // 1. Resolve or create user's wallet container
  let walletId: string | null = null;
  const { data: wallet } = await supabaseAdmin
    .from('wallets')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (wallet?.id) {
    walletId = wallet.id;
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
    walletId = newWallet?.id || null;
  }

  if (!walletId) {
    throw new Error(`Failed to resolve or create wallet for user ${userId}`);
  }

  // 2. Fetch or initialize wallet_assets record
  const { data: currentAsset } = await supabaseAdmin
    .from('wallet_assets')
    .select('available, locked_escrow, locked_withdrawal')
    .eq('wallet_id', walletId)
    .eq('asset_code', assetCode)
    .maybeSingle();

  const currentAvailable = Number(currentAsset?.available || 0);
  const currentLocked = Number(currentAsset?.locked_escrow || 0) + Number(currentAsset?.locked_withdrawal || 0);
  const newAvailable = currentAvailable + amount;

  if (!currentAsset) {
    await supabaseAdmin.from('wallet_assets').insert({
      wallet_id: walletId,
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
      .eq('wallet_id', walletId)
      .eq('asset_code', assetCode);
  }

  // 3. Write immutable ledger entry
  const idempotencyKey = `dep_fallback_${txHash}_${assetCode}`;
  await supabaseAdmin
    .from('ledger_entries')
    .insert({
      wallet_id: walletId,
      user_id: userId,
      asset_code: assetCode,
      delta_available: amount,
      delta_locked: 0,
      available_after: newAvailable,
      locked_after: currentLocked,
      entry_type: 'deposit_credit',
      ref_table: 'onchain_deposits',
      ref_id: txHash,
      idempotency_key: idempotencyKey,
    })
    .catch((err: any) => console.warn('Ledger entry insertion notice:', err.message));

  // 4. Update standard deposits table
  await supabaseAdmin
    .from('deposits')
    .upsert(
      {
        user_id: userId,
        wallet_id: walletId,
        asset_code: assetCode,
        network_code: network,
        amount: amount,
        txid: txHash,
        confirmations: getRequiredConfirmations(network),
        status: 'credited',
        credited_at: new Date().toISOString(),
        idempotency_key: `dep_tbl_${idempotencyKey}`,
      },
      { onConflict: 'idempotency_key' }
    )
    .catch((err: any) => console.warn('Deposits table upsert notice:', err.message));

  return { walletId, newBalance: newAvailable };
}

export async function POST(req: Request) {
  try {
    const payload: WebhookPayload = await req.json().catch(() => null);

    if (!payload) {
      return NextResponse.json(
        { error: 'Bad Request: Missing or invalid JSON body' },
        { status: 400 }
      );
    }

    const { txHash, network, toAddress, amount, assetSymbol, confirmations = 0, blockNumber } = payload;

    if (!txHash || !network || !toAddress || amount === undefined || amount === null || !assetSymbol) {
      return NextResponse.json(
        { error: 'Bad Request: Required fields missing (txHash, network, toAddress, amount, assetSymbol)' },
        { status: 400 }
      );
    }

    const numAmount = typeof amount === 'number' ? amount : parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return NextResponse.json(
        { error: 'Bad Request: Deposit amount must be a positive numeric value' },
        { status: 400 }
      );
    }

    const normalizedNetwork = network.toUpperCase().trim();
    const normalizedAsset = assetSymbol.toUpperCase().trim();
    const cleanedAddress = toAddress.trim();
    const requiredConfirmations = getRequiredConfirmations(normalizedNetwork);

    // 1. Resolve user ID from deposit address tables
    let userId: string | null = null;
    let walletId: string | null = null;

    // Check public.deposit_addresses
    const { data: addressRecord } = await supabaseAdmin
      .from('deposit_addresses')
      .select('id, user_id, wallet_id, address')
      .ilike('address', cleanedAddress)
      .maybeSingle();

    if (addressRecord) {
      userId = addressRecord.user_id;
      walletId = addressRecord.wallet_id;
    } else {
      // Fallback check in user_deposit_addresses
      const { data: userAddrRecord } = await supabaseAdmin
        .from('user_deposit_addresses')
        .select('user_id, address')
        .ilike('address', cleanedAddress)
        .maybeSingle();

      if (userAddrRecord) {
        userId = userAddrRecord.user_id;
      }
    }

    // If destination address does not belong to any platform user, ignore gracefully
    if (!userId) {
      return NextResponse.json({
        success: true,
        matched: false,
        message: 'Deposit address does not match any registered platform user deposit address.',
        toAddress: cleanedAddress,
        txHash,
      }, { status: 200 });
    }

    // 2. Check if this deposit has already been credited to prevent double spending
    const { data: existingOnchain } = await supabaseAdmin
      .from('onchain_deposits')
      .select('id, status, confirmations')
      .eq('tx_hash', txHash)
      .maybeSingle();

    if (existingOnchain && existingOnchain.status === 'CREDITED') {
      // Update confirmation count if higher
      if (confirmations > (existingOnchain.confirmations || 0)) {
        await supabaseAdmin
          .from('onchain_deposits')
          .update({ confirmations, updated_at: new Date().toISOString() })
          .eq('id', existingOnchain.id);
      }

      return NextResponse.json({
        success: true,
        status: 'ALREADY_CREDITED',
        message: 'Deposit transaction has already been processed and credited.',
        txHash,
        confirmations,
      }, { status: 200 });
    }

    const isConfirmed = confirmations >= requiredConfirmations;
    const initialStatus = isConfirmed ? 'CONFIRMED' : 'PENDING';

    // 3. Upsert into onchain_deposits table
    let onchainId = existingOnchain?.id;
    const { data: upsertedDeposit, error: upsertErr } = await supabaseAdmin
      .from('onchain_deposits')
      .upsert(
        {
          user_id: userId,
          tx_hash: txHash,
          network: normalizedNetwork,
          to_address: cleanedAddress,
          from_address: payload.fromAddress || null,
          amount: numAmount,
          asset_symbol: normalizedAsset,
          confirmations: confirmations,
          required_confirmations: requiredConfirmations,
          status: initialStatus,
          block_number: blockNumber || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tx_hash' }
      )
      .select()
      .maybeSingle();

    if (upsertErr) {
      console.warn('onchain_deposits upsert warning (table might be initializing):', upsertErr.message);
    } else if (upsertedDeposit?.id) {
      onchainId = upsertedDeposit.id;
    }

    // 4. If confirmed, execute credit via RPC process_confirmed_deposit
    let finalStatus = initialStatus;
    let creditResult: any = null;

    if (isConfirmed) {
      let rpcExecuted = false;

      // Attempt RPC invocation
      try {
        if (onchainId) {
          const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('process_confirmed_deposit', {
            p_deposit_id: onchainId,
          });

          if (!rpcError && rpcData?.success) {
            rpcExecuted = true;
            creditResult = rpcData;
            finalStatus = 'CREDITED';
          }
        }

        if (!rpcExecuted) {
          // Attempt parameter-based overload
          const { data: rpcDataParam, error: rpcParamErr } = await supabaseAdmin.rpc('process_confirmed_deposit', {
            p_user_id: userId,
            p_amount: numAmount,
            p_tx_hash: txHash,
            p_asset: normalizedAsset,
            p_network: normalizedNetwork,
          });

          if (!rpcParamErr && rpcDataParam?.success) {
            rpcExecuted = true;
            creditResult = rpcDataParam;
            finalStatus = 'CREDITED';
          }
        }
      } catch (rpcCallErr) {
        console.warn('RPC process_confirmed_deposit invocation warning, fallback applied:', rpcCallErr);
      }

      // Fallback direct credit if RPC is not deployed yet
      if (!rpcExecuted) {
        creditResult = await fallbackCreditConfirmedDeposit(
          userId,
          numAmount,
          txHash,
          normalizedAsset,
          normalizedNetwork
        );
        finalStatus = 'CREDITED';

        // Update onchain_deposits status
        await supabaseAdmin
          .from('onchain_deposits')
          .update({
            status: 'CREDITED',
            credited_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('tx_hash', txHash);
      }
    }

    return NextResponse.json({
      success: true,
      message: isConfirmed ? 'Deposit confirmed and credited successfully.' : 'Deposit registered as PENDING awaiting confirmations.',
      txHash,
      status: finalStatus,
      userId,
      amount: numAmount,
      assetSymbol: normalizedAsset,
      network: normalizedNetwork,
      confirmations,
      requiredConfirmations,
      creditResult: creditResult || undefined,
    }, { status: 200 });

  } catch (error: any) {
    console.error('Error in deposit webhook handler:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error while processing deposit webhook' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const txHash = url.searchParams.get('txHash') || url.searchParams.get('txid');

  if (!txHash) {
    return NextResponse.json({
      status: 'active',
      service: 'Paxones Deposit Ingestion Webhook Listener',
      timestamp: new Date().toISOString(),
      supportedNetworks: ['TRC20', 'ERC20', 'BEP20', 'POLYGON'],
    });
  }

  // Query deposit status
  const { data: deposit } = await supabaseAdmin
    .from('onchain_deposits')
    .select('*')
    .eq('tx_hash', txHash)
    .maybeSingle();

  if (!deposit) {
    return NextResponse.json({ found: false, message: 'Deposit transaction not found' }, { status: 404 });
  }

  return NextResponse.json({ found: true, deposit });
}
