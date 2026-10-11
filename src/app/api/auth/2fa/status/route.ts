import { NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminClient = getSupabaseAdminClient();
    const { data: profile } = await adminClient
      .from('profiles')
      .select('is_2fa_enabled, is_mfa_enabled, two_factor_enabled')
      .eq('id', user.id)
      .maybeSingle();

    const is2FAEnabled = Boolean(
      profile?.is_2fa_enabled || profile?.is_mfa_enabled || profile?.two_factor_enabled
    );

    return NextResponse.json({
      success: true,
      is_2fa_enabled: is2FAEnabled,
    });
  } catch (err: any) {
    console.error('Error fetching 2FA status:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch 2FA status' }, { status: 500 });
  }
}
