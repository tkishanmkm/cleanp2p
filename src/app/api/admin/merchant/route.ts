import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized) {
      return auth.response!;
    }

    const admin = getSupabaseAdminClient();

    const body = await req.json();
    const { userId, tier, depositUsdt, status } = body;

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId parameter' }, { status: 400 });
    }

    const { error: updateErr } = await admin
      .from('profiles')
      .update({
        merchant_tier: tier || null,
        merchant_deposit_usdt: depositUsdt || 0,
        merchant_status: status || (tier ? 'APPROVED' : 'NONE'),
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (updateErr) {
      console.error('Error updating merchant profile:', updateErr);
      return NextResponse.json({ error: 'Failed to update merchant profile' }, { status: 500 });
    }

    // Insert notification for the user
    await admin.from('notifications').insert([
      {
        user_id: userId,
        title: 'Merchant Application Update',
        message: tier
          ? `Your Merchant Application has been approved! You are now a verified ${tier} Merchant.`
          : `Your Merchant Tier has been updated by administration.`,
        type: 'merchant',
        is_read: false,
        metadata: { link: '/merchants' },
        created_at: new Date().toISOString(),
      },
    ]);

    return NextResponse.json({
      success: true,
      message: `Merchant tier updated to ${tier || 'Standard'}.`,
    });
  } catch (err: any) {
    console.error('POST /api/admin/merchant error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
