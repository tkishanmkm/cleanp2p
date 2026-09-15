import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function AdminDisputesPage() {
  const supabase = await createClient();

  const { data: disputes } = await supabase
    .from('disputes')
    .select(`
      *,
      trade:trade_id (
        *
      ),
      opener:opened_by(username)
    `)
    .order('created_at', { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Dispute Resolution Queue</h1>
          <p className="text-xs text-slate-400 mt-1">Review active escrow arbitrations, evidence transcripts, and trade interventions.</p>
        </div>
      </div>

      <div className="bg-[#0f1423] border border-[#1e2640] rounded-xl overflow-x-auto shadow-lg">
        <table className="w-full text-left text-xs text-slate-300 min-w-[750px]">
          <thead className="bg-[#07090e] border-b border-[#1e2640] text-slate-400 uppercase font-semibold">
            <tr>
              <th className="p-4">Trade ID</th>
              <th className="p-4">Opened By</th>
              <th className="p-4">Buyer vs Seller</th>
              <th className="p-4">Amount</th>
              <th className="p-4">Reason</th>
              <th className="p-4">Status</th>
              <th className="p-4">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1e2640]">
            {disputes && disputes.length > 0 ? (
              disputes.map((dispute: any) => (
                <tr key={dispute.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="p-4 font-mono text-blue-400">
                    {dispute.trade?.public_id || dispute.trade_id?.slice(0, 8)}
                  </td>
                  <td className="p-4">@{dispute.opener?.username || 'User'}</td>
                  <td className="p-4">
                    <span className="text-emerald-400">@{dispute.trade?.buyer?.username || 'Buyer'}</span>
                    {' / '}
                    <span className="text-amber-400">@{dispute.trade?.seller?.username || 'Seller'}</span>
                  </td>
                  <td className="p-4 font-mono font-medium text-white">
                    {dispute.trade?.fiat_amount} {dispute.trade?.fiat_currency}
                  </td>
                  <td className="p-4 max-w-[200px] truncate" title={dispute.reason}>
                    {dispute.reason}
                  </td>
                  <td className="p-4">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                      dispute.status === 'open'
                        ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                        : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    }`}>
                      {dispute.status}
                    </span>
                  </td>
                  <td className="p-4">
                    <Link
                      href={`/trade/${dispute.trade_id}`}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition-colors inline-block"
                    >
                      Arbitrate →
                    </Link>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-500">
                  No active trade disputes in arbitration.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
