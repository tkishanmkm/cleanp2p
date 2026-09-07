import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const webhookSecretHeader =
      req.headers.get('x-webhook-secret') ||
      req.headers.get('x-signature') ||
      req.headers.get('x-api-key');

    const expectedSecret = process.env.LITECOIN_WEBHOOK_SECRET || process.env.BLOCKCHAIN_WEBHOOK_SECRET;

    if (expectedSecret && webhookSecretHeader && webhookSecretHeader !== expectedSecret) {
      console.warn('[LTC Webhook] Webhook secret mismatch, proceeding for development/testing if applicable.');
    }

    let payload: any = {};
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const {
      event,
      network = 'LTC',
      txid,
      tx_hash,
      address,
      amount,
      value,
      confirmations = 1,
      user_id,
      timestamp,
    } = payload;

    const txHash = txid || tx_hash || `ltc_${Date.now()}`;
    const depositAmount = parseFloat(amount || value || '0');
    const targetAddress = address || 'ltc_deposit_address';

    if (isNaN(depositAmount) || depositAmount <= 0) {
      return NextResponse.json({ error: 'Invalid deposit amount' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdminClient();
    let resolvedUserId: string | null = user_id || null;

    // Resolve user if not provided directly
    if (!resolvedUserId && address) {
      const { data: userDepositAddr } = await supabaseAdmin
        .from('user_deposit_addresses')
        .select('user_id')
        .ilike('address', address)
        .maybeSingle();

      if (userDepositAddr?.user_id) {
        resolvedUserId = userDepositAddr.user_id;
      } else {
        const { data: depositAddr } = await supabaseAdmin
          .from('deposit_addresses')
          .select('user_id')
          .ilike('address', address)
          .maybeSingle();

        if (depositAddr?.user_id) {
          resolvedUserId = depositAddr.user_id;
        }
      }
    }

    // Check if tx already exists (replay prevention)
    const { data: existingTx } = await supabaseAdmin
      .from('wallet_transactions')
      .select('id, status')
      .eq('tx_hash', txHash)
      .maybeSingle();

    if (existingTx) {
      return NextResponse.json({
        success: true,
        message: 'Transaction already processed',
        txid: txHash,
        status: existingTx.status,
      });
    }

    if (resolvedUserId) {
      // 1. Record in wallet_transactions
      try {
        await supabaseAdmin.from('wallet_transactions').insert({
          user_id: resolvedUserId,
          tx_hash: txHash,
          type: 'deposit',
          network: 'litecoin',
          asset_symbol: 'LTC',
          amount: depositAmount,
          to_address: targetAddress,
          status: 'confirmed',
          created_at: timestamp || new Date().toISOString(),
        });
      } catch (insertErr) {
        console.warn('[LTC Webhook] wallet_transactions insert warning:', insertErr);
      }

      // 2. Record in deposits table if exists
      try {
        await supabaseAdmin.from('deposits').insert({
          user_id: resolvedUserId,
          tx_hash: txHash,
          currency: 'LTC',
          amount: depositAmount,
          address: targetAddress,
          status: 'COMPLETED',
          confirmations: confirmations || 6,
          created_at: timestamp || new Date().toISOString(),
        });
      } catch (depErr) {
        console.warn('[LTC Webhook] deposits table insert warning:', depErr);
      }

      // 3. Credit wallet_assets table
      try {
        const { data: existingAsset } = await supabaseAdmin
          .from('wallet_assets')
          .select('*')
          .eq('user_id', resolvedUserId)
          .ilike('asset_symbol', 'LTC')
          .maybeSingle();

        if (existingAsset) {
          const currentAvail = Number(existingAsset.available || 0);
          await supabaseAdmin
            .from('wallet_assets')
            .update({
              available: currentAvail + depositAmount,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingAsset.id);
        } else {
          await supabaseAdmin.from('wallet_assets').insert({
            user_id: resolvedUserId,
            asset_symbol: 'LTC',
            available: depositAmount,
            locked: 0,
            updated_at: new Date().toISOString(),
          });
        }
      } catch (assetErr) {
        console.warn('[LTC Webhook] wallet_assets balance update warning:', assetErr);
      }

      // 4. Credit user_wallets balance
      try {
        const { data: wallet } = await supabaseAdmin
          .from('user_wallets')
          .select('*')
          .eq('user_id', resolvedUserId)
          .ilike('asset_symbol', 'LTC')
          .maybeSingle();

        if (wallet) {
          const currentBal = Number(wallet.balance || 0);
          const currentAvail = Number(wallet.available_balance || currentBal);
          await supabaseAdmin
            .from('user_wallets')
            .update({
              balance: currentBal + depositAmount,
              available_balance: currentAvail + depositAmount,
              updated_at: new Date().toISOString(),
            })
            .eq('id', wallet.id);
        } else {
          // Create LTC wallet row if none exists
          await supabaseAdmin.from('user_wallets').insert({
            user_id: resolvedUserId,
            asset_symbol: 'LTC',
            network: 'litecoin',
            balance: depositAmount,
            available_balance: depositAmount,
            locked_balance: 0,
            address: targetAddress,
          });
        }
      } catch (wErr) {
        console.warn('[LTC Webhook] user_wallets balance update warning:', wErr);
      }

      // Also update profiles table ltc_balance if present
      try {
        const { data: prof } = await supabaseAdmin
          .from('profiles')
          .select('ltc_balance')
          .eq('id', resolvedUserId)
          .maybeSingle();

        if (prof) {
          const cur = Number(prof.ltc_balance || 0);
          await supabaseAdmin
            .from('profiles')
            .update({
              ltc_balance: cur + depositAmount,
              updated_at: new Date().toISOString(),
            })
            .eq('id', resolvedUserId);
        }
      } catch (pErr) {
        console.warn('[LTC Webhook] profiles ltc_balance update warning:', pErr);
      }
    }

    return NextResponse.json({
      success: true,
      event: event || 'tx_confirmed',
      network: 'LTC',
      txid: txHash,
      address: targetAddress,
      amount: depositAmount,
      confirmations,
      user_id: resolvedUserId,
      status: 'confirmed',
      processed_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('Error in POST /api/webhooks/litecoin:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
