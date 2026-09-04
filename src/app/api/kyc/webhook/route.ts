import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/utils/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { vendor_session_id, status, user_id, client_reference_id } = body;

    // Didit can pass target user ID in user_id or client_reference_id
    const targetUserId = user_id || client_reference_id;

    // Map Didit status to platform status
    let kycStatus = 'PENDING';
    if (status === 'approved' || status === 'completed') kycStatus = 'APPROVED';
    else if (status === 'rejected') kycStatus = 'REJECTED';
    else if (status === 'expired') kycStatus = 'EXPIRED';

    if (targetUserId) {
      const supabaseAdmin = getSupabaseAdminClient();
      await supabaseAdmin
        .from('profiles')
        .update({
          kyc_status: kycStatus,
          kyc_vendor_session_id: vendor_session_id,
        })
        .eq('id', targetUserId);
    }

    return NextResponse.json({ received: true, kyc_status: kycStatus });
  } catch (err: any) {
    console.error('Error handling KYC webhook:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
