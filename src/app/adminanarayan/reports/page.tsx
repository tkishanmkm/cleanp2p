import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function AdminReportsPage() {
  const supabase = await createClient();

  const { data: reports, error } = await supabase
    .from('trade_reports')
    .select(`
      *,
      reporter:reporter_id(username, email),
      reported_user:reported_user_id(username, email)
    `)
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('Trade reports query fallback:', error);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Trade Security & Issue Reports</h1>
        <p className="text-xs text-slate-400 mt-1">Review flagged post-trade disputes, chargebacks, and compliance violations.</p>
      </div>
      
      <div className="bg-[#0f1423] border border-[#1e2640] rounded-xl overflow-x-auto shadow-lg">
        <table className="w-full text-left text-xs text-slate-300 min-w-[700px]">
          <thead className="bg-[#07090e] border-b border-[#1e2640] text-slate-400 uppercase font-semibold">
            <tr>
              <th className="p-4">Report ID</th>
              <th className="p-4">Trade ID</th>
              <th className="p-4">Reporter</th>
              <th className="p-4">Reported User</th>
              <th className="p-4">Category</th>
              <th className="p-4">Status</th>
              <th className="p-4">Evidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1e2640]">
            {reports && reports.length > 0 ? (
              reports.map((report: any) => (
                <tr key={report.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="p-4 font-mono text-blue-400">{report.report_id || report.id?.slice(0, 8)}</td>
                  <td className="p-4 font-mono text-slate-200">{report.trade_public_id || report.trade_id?.slice(0, 8)}</td>
                  <td className="p-4 font-medium text-slate-200">
                    {report.reporter?.username ? `@${report.reporter.username}` : (report.reporter?.email || 'User')}
                  </td>
                  <td className="p-4 text-red-400 font-medium">
                    {report.reported_user?.username ? `@${report.reported_user.username}` : (report.reported_user?.email || 'N/A')}
                  </td>
                  <td className="p-4 font-medium max-w-[200px] truncate" title={report.category}>
                    {report.category}
                  </td>
                  <td className="p-4">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide uppercase ${
                      report.status === 'PENDING_REVIEW'
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : report.status === 'INVESTIGATING'
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    }`}>
                      {report.status || 'PENDING_REVIEW'}
                    </span>
                  </td>
                  <td className="p-4">
                    {report.evidence_urls && report.evidence_urls.length > 0 ? (
                      <a
                        href={report.evidence_urls[0]}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 text-blue-400 underline hover:text-blue-300 font-medium"
                      >
                        View Link ↗
                      </a>
                    ) : (
                      <span className="text-slate-500">None</span>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-500">
                  No security issues or reports submitted.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
