import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Authenticate Admin User
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: 'Invalid admin session' }, { status: 401 });
    }

    // Verify Admin Role from profiles/roles table (supporting both uppercase and lowercase)
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role, is_admin')
      .eq('id', user.id)
      .single();

    const normalizedRole = (profile?.role || '').toUpperCase();
    const isUserAdmin = normalizedRole === 'ADMIN' || normalizedRole === 'SUPER_ADMIN' || Boolean(profile?.is_admin);

    if (!isUserAdmin) {
      // Also fallback check app_admins table
      const { data: adminRecord } = await supabaseAdmin
        .from('app_admins')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!adminRecord) {
        return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
      }
    }

    const { withdrawalId, action, rejectionReason } = await req.json();

    if (!withdrawalId || !['APPROVE', 'REJECT'].includes(action)) {
      return NextResponse.json({ error: 'Invalid payload parameters' }, { status: 400 });
    }

    if (action === 'APPROVE') {
      // Transition from NEEDS_APPROVAL -> PENDING so worker picks it up
      const { error } = await supabaseAdmin
        .from('onchain_withdrawals')
        .update({
          status: 'PENDING',
          approved_by: user.id,
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', withdrawalId)
        .eq('status', 'NEEDS_APPROVAL');

      if (error) throw error;

      return NextResponse.json({
        success: true,
        message: 'Withdrawal approved and dispatched to dispatch queue.',
      });
    } else {
      // Call refund procedure to unlock user balance
      const { error: rpcError } = await supabaseAdmin.rpc('process_failed_withdrawal', {
        p_withdrawal_id: withdrawalId,
        p_error_reason: rejectionReason || 'Rejected by administrator during security review.',
      });

      if (rpcError) throw rpcError;

      return NextResponse.json({
        success: true,
        message: 'Withdrawal rejected and funds refunded to user.',
      });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
