import { NextRequest, NextResponse } from 'next/server';
import { runFinancialReconciliation } from '@/lib/security/reconciliation';
import { verifyServerAdmin } from '@/lib/server-admin-auth';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyWorkerAuth } from '@/lib/security/worker-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isCronAuthorized(req: NextRequest): boolean {
  const result = verifyWorkerAuth(req, {
    allowedSecrets: [
      process.env.CRON_SECRET,
      process.env.CRON_SECRET_KEY,
      process.env.WORKER_SECRET,
    ],
    customHeaderNames: ['x-cron-secret'],
  });

  return result.authorized;
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
      const adminAuth = await verifyServerAdmin(req);
      if (!adminAuth.authorized) {
        return (
          adminAuth.response ||
          NextResponse.json(
            { error: 'Unauthorized: Admin session or valid CRON_SECRET required' },
            { status: 401 }
          )
        );
      }

      triggeredBy = 'ADMIN';
      adminUserId = adminAuth.adminId || adminAuth.user?.id;
    }

    const supabaseAdmin = getSupabaseAdminClient();
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
