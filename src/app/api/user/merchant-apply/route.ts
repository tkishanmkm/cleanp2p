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

    // Submit or record application
    const { error: updateErr } = await admin
      .from('profiles')
      .update({
        merchant_applied_tier: targetTier,
        merchant_status: 'PENDING',
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
        message: `Your application for ${tierConfig.name} (${tierConfig.depositUSDT.toLocaleString()} USDT deposit) is under review.`,
        link: '/merchants',
        is_read: false,
        created_at: new Date().toISOString(),
      },
    ]);

    return NextResponse.json({
      success: true,
      message: `Your application for ${tierConfig.name} has been submitted to Paxones compliance.`,
    });
  } catch (err: any) {
    console.error('POST /api/user/merchant-apply error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
