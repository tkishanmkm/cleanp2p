import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { runFinancialReconciliation } from '@/lib/security/reconciliation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key',
  { auth: { persistSession: false, autoRefreshToken: false } }
);

function isCronAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET || process.env.CRON_SECRET_KEY || process.env.WORKER_SECRET;
  if (!cronSecret || cronSecret.trim().length === 0) return false;

  const authHeader = req.headers.get('authorization');
  const xCronHeader = req.headers.get('x-cron-secret');

  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
  return bearerToken === cronSecret || xCronHeader === cronSecret;
}

export async function POST(req: NextRequest) {
  try {
    let triggeredBy: 'ADMIN' | 'CRON' = 'CRON';
    let adminUserId: string | null = null;

    // 1. Check if authorized via CRON_SECRET
    if (isCronAuthorized(req)) {
      triggeredBy = 'CRON';
    } else {
      // 2. Check if authorized via authenticated admin session
      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll() {
              return req.cookies.getAll();
            },
          },
        }
      );

      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        return NextResponse.json(
          { error: 'Unauthorized: Admin session or valid CRON_SECRET required' },
          { status: 401 }
        );
      }

      const { data: isAdmin, error: adminErr } = await supabaseAdmin.rpc('check_is_admin', {
        p_user_id: user.id,
      });

      if (adminErr || !isAdmin) {
        return NextResponse.json(
          { error: 'Forbidden: Admin privilege required' },
          { status: 403 }
        );
      }

      triggeredBy = 'ADMIN';
      adminUserId = user.id;
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || '127.0.0.1';

    // 3. Execute financial reconciliation sweep
    const report = await runFinancialReconciliation();

    // 4. Log in admin_audit_logs
    try {
      await supabaseAdmin.from('admin_audit_logs').insert({
        admin_id: adminUserId,
        action: 'EXECUTE_RECONCILIATION',
        details: {
          triggeredBy,
          totalAudited: report.totalUsersAudited,
          balanced: report.balancedWallets,
          anomaliesCount: report.anomalousWallets,
          isBalanced: report.isBalanced,
          totalLiability: report.totalLiability,
        },
        ip_address: ip,
      });
    } catch (_) {}

    return NextResponse.json({
      success: true,
      triggeredBy,
      report,
    });
  } catch (err: any) {
    console.error('[Admin Reconcile API] Error running financial reconciliation:', err);
    return NextResponse.json(
      { error: err.message || 'Internal error executing reconciliation' },
      { status: 500 }
    );
  }
}
