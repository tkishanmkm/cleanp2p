import { NextResponse, type NextRequest } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/utils/supabase/server';
import { MERCHANT_TIERS, type MerchantTier } from '@/lib/merchant';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized: Please sign in to apply for Merchant status.' }, { status: 401 });
    }

    const body = await req.json();
    const { targetTier } = body;

    if (!targetTier || !MERCHANT_TIERS[targetTier as MerchantTier]) {
      return NextResponse.json({ error: 'Invalid merchant tier requested.' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();

    // Check user profile KYC and volume
    const { data: profile } = await admin
      .from('profiles')
      .select('id, username, kyc_status, total_volume_usd, merchant_tier')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found.' }, { status: 404 });
    }

    const tierConfig = MERCHANT_TIERS[targetTier as MerchantTier];

    // 1. ELIGIBILITY CHECK: Check user trading volume
    let tradeVolumeUsd = Number(profile.total_volume_usd || 0);
    const { data: completedTrades } = await admin
      .from('trades')
      .select('fiat_amount')
      .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
      .eq('status', 'COMPLETED');

    if (completedTrades && completedTrades.length > 0) {
      for (const t of completedTrades) {
        tradeVolumeUsd += Number(t.fiat_amount || 0);
      }
    }

    if (tradeVolumeUsd < tierConfig.requiredVolumeUsd) {
      return NextResponse.json({
        error: `Eligibility requirement not met: A minimum 30-day trading volume of $${tierConfig.requiredVolumeUsd.toLocaleString()} USD is required for ${tierConfig.label}. Your current volume is $${Math.round(tradeVolumeUsd).toLocaleString()} USD. Complete more trades to unlock eligibility.`
      }, { status: 400 });
    }

    // 2. LOCKING USDT FOR MERCHANT TAG
    const requiredDeposit = tierConfig.requiredDepositUsdt;
    const { data: usdtAsset } = await admin
      .from('wallet_assets')
      .select('id, balance, locked_balance')
      .eq('user_id', user.id)
      .eq('asset_symbol', 'USDT')
      .maybeSingle();

    const availableBalance = Number(usdtAsset?.balance || 0);
    const lockedBalance = Number(usdtAsset?.locked_balance || 0);

    if (availableBalance < requiredDeposit) {
      return NextResponse.json({
        error: `Insufficient available USDT balance. You need at least ${requiredDeposit.toLocaleString()} USDT available in your wallet to lock as a merchant security deposit bond. Current available balance: ${availableBalance.toFixed(2)} USDT.`
      }, { status: 400 });
    }

    // Deduct from available balance and add to locked_balance in wallet_assets
    if (usdtAsset?.id) {
      const { error: lockErr } = await admin
        .from('wallet_assets')
        .update({
          balance: Number((availableBalance - requiredDeposit).toFixed(8)),
          locked_balance: Number((lockedBalance + requiredDeposit).toFixed(8)),
          updated_at: new Date().toISOString(),
        })
        .eq('id', usdtAsset.id);

      if (lockErr) {
        console.error('Error locking merchant USDT deposit:', lockErr);
        return NextResponse.json({ error: 'Failed to lock USDT security deposit. Please try again.' }, { status: 500 });
      }
    }

    // Update profile to activate merchant tier and record locked deposit
    const { error: updateErr } = await admin
      .from('profiles')
      .update({
        merchant_tier: targetTier,
        merchant_applied_tier: targetTier,
        merchant_status: 'ACTIVE',
        merchant_deposit_usdt: requiredDeposit,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (updateErr) {
      throw updateErr;
    }

    // Insert user notification
    await admin.from('notifications').insert([
      {
        user_id: user.id,
        message: `Congratulations! ${requiredDeposit.toLocaleString()} USDT has been locked as security deposit. Your ${tierConfig.label} badge is now active!`,
        link: '/merchants',
        is_read: false,
        created_at: new Date().toISOString(),
      },
    ]);

    return NextResponse.json({
      success: true,
      message: `Congratulations! ${requiredDeposit.toLocaleString()} USDT has been locked as security deposit. Your ${tierConfig.label} badge is now active!`,
      tier: targetTier,
      depositLocked: requiredDeposit,
    });
  } catch (err: any) {
    console.error('POST /api/user/merchant-apply error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
