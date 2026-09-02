import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized: Missing authorization header.' },
        { status: 401 }
      );
    }

    const supabaseAdmin = getSupabaseAdminClient();

    // 1. Verify caller session / token
    const { data: userData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !userData?.user) {
      return NextResponse.json(
        { error: 'Unauthorized: Invalid token.' },
        { status: 401 }
      );
    }

    const callerId = userData.user.id;

    // 2. Verify admin role in app_admins table or profiles table
    const { data: adminRecord } = await supabaseAdmin
      .from('app_admins')
      .select('user_id')
      .eq('user_id', callerId)
      .maybeSingle();

    const { data: profileRecord } = await supabaseAdmin
      .from('profiles')
      .select('role, is_admin')
      .eq('id', callerId)
      .maybeSingle();

    const isAuthorizedAdmin = Boolean(
      adminRecord ||
      profileRecord?.role === 'admin' ||
      profileRecord?.is_admin
    );

    if (!isAuthorizedAdmin) {
      return NextResponse.json(
        { error: 'Forbidden: Caller is not an authorized administrator.' },
        { status: 403 }
      );
    }

    // 3. Parse request payload
    const body = await req.json().catch(() => ({}));
    const { withdrawalId } = body;

    if (!withdrawalId || typeof withdrawalId !== 'string') {
      return NextResponse.json(
        { error: 'Bad Request: Missing or invalid withdrawalId.' },
        { status: 400 }
      );
    }

    // 4. Fetch withdrawal record and verify status
    const { data: withdrawal, error: fetchError } = await supabaseAdmin
      .from('withdrawals')
      .select('*')
      .eq('id', withdrawalId)
      .maybeSingle();

    if (fetchError || !withdrawal) {
      return NextResponse.json(
        { error: 'Not Found: Withdrawal record not found.' },
        { status: 404 }
      );
    }

    if (withdrawal.status !== 'pending') {
      return NextResponse.json(
        { error: `Conflict: Cannot approve withdrawal with status '${withdrawal.status}'. Must be 'pending'.` },
        { status: 409 }
      );
    }

    // 5. Update withdrawal status to 'approved'
    const { data: updatedWithdrawal, error: updateError } = await supabaseAdmin
      .from('withdrawals')
      .update({
        status: 'approved',
        approved_by: callerId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', withdrawalId)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: `Internal Server Error: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      status: 'approved',
      withdrawalId: updatedWithdrawal.id,
      approvedBy: callerId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error.';
    return NextResponse.json(
      { error: `Internal Server Error: ${message}` },
      { status: 500 }
    );
  }
}
