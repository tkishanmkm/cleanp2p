import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized) {
      return auth.response!;
    }

    const supabaseAdmin = getSupabaseAdminClient();

    // Parse query parameters
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const actionFilter = searchParams.get('action');
    const adminIdFilter = searchParams.get('admin_id');
    const fromDate = searchParams.get('from');
    const toDate = searchParams.get('to');

    const offset = (page - 1) * limit;

    // Build query
    let query = supabaseAdmin
      .from('admin_audit_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (actionFilter) {
      query = query.eq('action', actionFilter.trim().toUpperCase());
    }

    if (adminIdFilter) {
      query = query.eq('admin_id', adminIdFilter.trim());
    }

    if (fromDate) {
      query = query.gte('created_at', fromDate);
    }

    if (toDate) {
      query = query.lte('created_at', toDate);
    }

    const { data: logs, count, error: queryErr } = await query.range(offset, offset + limit - 1);

    if (queryErr) {
      return NextResponse.json({ error: queryErr.message }, { status: 500 });
    }

    const total = count || 0;
    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      success: true,
      logs: logs || [],
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  } catch (err: any) {
    console.error('[Admin Audit Logs API] Error fetching logs:', err);
    return NextResponse.json(
      { error: err.message || 'Internal error fetching audit logs' },
      { status: 500 }
    );
  }
}
