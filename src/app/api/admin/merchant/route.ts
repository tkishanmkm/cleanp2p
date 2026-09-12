import { NextResponse, type NextRequest } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/utils/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = getSupabaseAdminClient();

    // Verify admin privileges
    const { data: adminProf } = await admin
      .from('profiles')
      .select('role, is_admin')
      .eq('id', user.id)
      .maybeSingle();

    const isAdmin = adminProf?.is_admin === true || adminProf?.role === 'ADMIN' || adminProf?.role === 'SUPER_ADMIN';
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden: Admin access required.' }, { status: 403 });
    }

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
        message: tier
          ? `Your Merchant Application has been approved! You are now a verified ${tier} Merchant.`
          : `Your Merchant Tier has been updated by administration.`,
        link: '/merchants',
        is_read: false,
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
