import { NextRequest, NextResponse } from 'next/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { logAdminSecurityAudit } from '@/lib/admin-security';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized) return auth.response!;
    if (auth.supportAdmin === true) {
      return NextResponse.json({ success: false, error: 'Support administrators cannot change full-admin security preferences.' }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some((key) => key !== 'theme')) {
      return NextResponse.json({ success: false, error: 'A valid theme request is required.' }, { status: 400 });
    }

    const theme = (body as Record<string, unknown>).theme;
    if (theme !== 'light' && theme !== 'dark' && theme !== 'system') {
      return NextResponse.json({ success: false, error: 'Invalid theme choice.' }, { status: 400 });
    }

    const adminId = auth.user.id;
    const adminEmail = auth.adminEmail || auth.user.email || 'admin';
    const adminDb = getSupabaseAdminClient();
    const { data: updatedRows, error: updateError } = await adminDb
      .from('profiles')
      .update({ admin_theme_preference: theme, updated_at: new Date().toISOString() })
      .eq('id', adminId)
      .select('id');

    if (updateError || !Array.isArray(updatedRows) || updatedRows.length !== 1) {
      console.error('[ADMIN_THEME] Preference update failed:', updateError?.code || 'no_row_updated');
      return NextResponse.json({ success: false, error: 'Administrator theme preference could not be saved.' }, { status: 503 });
    }

    const auditSaved = await logAdminSecurityAudit({
      adminId,
      adminEmail,
      action: 'ADMIN_THEME_CHANGED',
      details: { new_theme: theme },
      ipAddress: 'server-observed',
    });
    if (!auditSaved) {
      return NextResponse.json({
        success: false,
        saved: true,
        error: 'The theme preference was saved, but the security audit could not be recorded. Contact an administrator.',
      }, { status: 503 });
    }

    return NextResponse.json({
      success: true,
      theme,
      message: `Admin theme set to ${theme}`,
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error: unknown) {
    console.error('[ADMIN_THEME] Update failed:', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ success: false, error: 'Theme preference could not be updated.' }, { status: 500 });
  }
}
