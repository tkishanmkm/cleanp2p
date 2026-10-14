import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { logAdminSecurityAudit } from '@/lib/admin-security';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { theme } = await req.json();
    if (!theme || !['light', 'dark', 'system'].includes(theme)) {
      return NextResponse.json({ error: 'Invalid theme choice' }, { status: 400 });
    }

    const adminId = session.user.id;
    const adminEmail = session.user.email || 'admin';
    const adminDb = getSupabaseAdminClient();

    await adminDb
      .from('profiles')
      .update({
        admin_theme_preference: theme,
      })
      .eq('id', adminId);

    const clientIp = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
    await logAdminSecurityAudit({
      adminId,
      adminEmail,
      action: 'ADMIN_THEME_CHANGED',
      details: { new_theme: theme },
      ipAddress: clientIp,
    });

    return NextResponse.json({
      success: true,
      theme,
      message: `Admin theme set to ${theme}`,
    });
  } catch (error: any) {
    console.error('Theme Update Error:', error);
    return NextResponse.json({ error: error.message || 'Theme update failed' }, { status: 500 });
  }
}
