import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

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

    // 3. Record raw blockchain transaction
    await supabaseAdmin
      .from('blockchain_transactions')
      .upsert(
        {
          network_code: networkCode,
          txid,
          output_index: outputIndex,
          to_address: toAddress,
          from_address: fromAddress || null,
          asset_code: assetCode,
          amount: numAmount,
          block_height: blockHeight || null,
          confirmations,
          direction: 'incoming',
        },
        { onConflict: 'network_code,txid,output_index' }
      );

    // 4. Match toAddress against active deposit_addresses
    const { data: addressRecord, error: addressError } = await supabaseAdmin
      .from('deposit_addresses')
      .select('id, wallet_id, user_id, asset_code, network_code')
      .eq('address', toAddress)
      .eq('status', 'active')
      .maybeSingle();

    if (addressError) {
      return NextResponse.json(
        { error: `Database error querying deposit address: ${addressError.message}` },
        { status: 500 }
      );
    }

    if (!addressRecord) {
      // Unmatched address (e.g. platform sweep or unrelated transaction)
      return NextResponse.json({
        success: true,
        matched: false,
        message: 'Transaction recorded; address is not an active user deposit address.',
      });
    }

    // 5. Fetch network required confirmations
    const { data: networkConfig } = await supabaseAdmin
      .from('asset_networks')
      .select('required_confirmations, min_deposit')
      .eq('asset_code', assetCode)
      .eq('network_code', networkCode)
      .maybeSingle();

    const requiredConfirmations = networkConfig?.required_confirmations || 3;
    const minDeposit = Number(networkConfig?.min_deposit || 0);

    if (numAmount < minDeposit) {
      return NextResponse.json({
        success: true,
        matched: true,
        message: `Deposit amount (${numAmount}) is below minimum limit (${minDeposit}).`,
        depositStatus: 'ignored_below_min',
      });
    }

    const idempotencyKey = `dep_${networkCode}_${txid}_${outputIndex}`;

    // 6. Check existing deposit record
    const { data: existingDeposit } = await supabaseAdmin
      .from('deposits')
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    let depositStatus: 'detected' | 'pending' | 'confirmed' | 'credited' = 'detected';
    if (confirmations >= requiredConfirmations) {
      depositStatus = 'confirmed';
    } else if (confirmations > 0) {
      depositStatus = 'pending';
    }

    // If already credited, only update confirmations
    if (existingDeposit?.status === 'credited') {
      await supabaseAdmin
        .from('deposits')
        .update({
          confirmations,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingDeposit.id);

      return NextResponse.json({
        success: true,
        matched: true,
        depositStatus: 'credited',
        message: 'Deposit already credited; updated confirmation count.',
      });
    }

    // 7. Upsert Deposit Record
    let depositId = existingDeposit?.id;
    if (!existingDeposit) {
      const { data: newDeposit, error: depositInsertError } = await supabaseAdmin
        .from('deposits')
        .insert({
          user_id: addressRecord.user_id,
          wallet_id: addressRecord.wallet_id,
          asset_code: assetCode,
          network_code: networkCode,
          deposit_address_id: addressRecord.id,
          amount: numAmount,
          txid,
          output_index: outputIndex,
          confirmations,
          status: depositStatus,
          idempotency_key: idempotencyKey,
        })
        .select('id')
        .single();

      if (depositInsertError) {
        return NextResponse.json(
          { error: `Failed to insert deposit: ${depositInsertError.message}` },
          { status: 500 }
        );
      }
      depositId = newDeposit.id;
    } else {
      await supabaseAdmin
        .from('deposits')
        .update({
          confirmations,
          status: depositStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingDeposit.id);
    }

    // 8. If confirmed and ready to credit:
    if (confirmations >= requiredConfirmations) {
      // Fetch current asset balance
      const { data: walletAsset, error: assetFetchError } = await supabaseAdmin
        .from('wallet_assets')
        .select('available, locked_escrow, locked_withdrawal')
        .eq('wallet_id', addressRecord.wallet_id)
        .eq('asset_code', assetCode)
        .maybeSingle();

      if (assetFetchError) {
        return NextResponse.json(
          { error: `Error fetching wallet asset: ${assetFetchError.message}` },
          { status: 500 }
        );
      }

      const currentAvailable = Number(walletAsset?.available || 0);
      const currentLockedEscrow = Number(walletAsset?.locked_escrow || 0);
      const currentLockedWithdrawal = Number(walletAsset?.locked_withdrawal || 0);
      const newAvailable = currentAvailable + numAmount;

      // Credit wallet_assets
      if (!walletAsset) {
        await supabaseAdmin.from('wallet_assets').insert({
          wallet_id: addressRecord.wallet_id,
          asset_code: assetCode,
          available: numAmount,
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
          .eq('wallet_id', addressRecord.wallet_id)
          .eq('asset_code', assetCode);
      }

      // Record immutable ledger entry
      await supabaseAdmin.from('ledger_entries').insert({
        wallet_id: addressRecord.wallet_id,
        user_id: addressRecord.user_id,
        asset_code: assetCode,
        delta_available: numAmount,
        delta_locked: 0,
        available_after: newAvailable,
        locked_after: currentLockedEscrow + currentLockedWithdrawal,
        entry_type: 'deposit_credit',
        ref_table: 'deposits',
        ref_id: depositId,
        idempotency_key: `ledger_${idempotencyKey}`,
      });

      // Update deposit status to 'credited'
      await supabaseAdmin
        .from('deposits')
        .update({
          status: 'credited',
          credited_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', depositId);

      return NextResponse.json({
        success: true,
        matched: true,
        depositStatus: 'credited',
        creditedAmount: numAmount,
        confirmations,
      });
    }

    return NextResponse.json({
      success: true,
      matched: true,
      depositStatus,
      confirmations,
      requiredConfirmations,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error.';
    return NextResponse.json(
      { error: `Internal Server Error: ${message}` },
      { status: 500 }
    );
  }
}
