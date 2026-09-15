import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function AdminTreasuryPage() {
  const supabase = await createClient();

  const { data: transfers } = await supabase
    .from('internal_transfers')
    .select(`
      *,
      sender:sender_id(username),
      recipient:recipient_id(username)
    `)
    .order('created_at', { ascending: false })
    .limit(100);

  // Calculate total fees collected
  const totalFeesByAsset: Record<string, number> = {};
  (transfers || []).forEach((t: any) => {
    const sym = t.asset_symbol || 'USDT';
    const fee = Number(t.fee_amount || 0);
    totalFeesByAsset[sym] = (totalFeesByAsset[sym] || 0) + fee;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Treasury & 1.5% Internal Fee Ledger</h1>
        <p className="text-xs text-slate-400 mt-1">Audit platform revenue, internal wallet settlement cuts, and fee reserves.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {Object.keys(totalFeesByAsset).length > 0 ? (
          Object.entries(totalFeesByAsset).map(([symbol, total]) => (
            <div key={symbol} className="bg-[#0f1423] border border-[#1e2640] rounded-xl p-5 shadow-sm">
              <div className="text-xs font-semibold uppercase text-slate-400">Total {symbol} Platform Fees (1.5%)</div>
              <div className="text-2xl font-mono font-extrabold text-emerald-400 mt-2">
                {total.toFixed(6)} {symbol}
              </div>
            </div>
          ))
        ) : (
          <div className="bg-[#0f1423] border border-[#1e2640] rounded-xl p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase text-slate-400">Total Platform Fee Reserve</div>
            <div className="text-2xl font-mono font-extrabold text-emerald-400 mt-2">0.000000 USDT</div>
          </div>
        )}
      </div>

      <div className="bg-[#0f1423] border border-[#1e2640] rounded-xl overflow-x-auto shadow-lg">
        <table className="w-full text-left text-xs text-slate-300 min-w-[700px]">
          <thead className="bg-[#07090e] border-b border-[#1e2640] text-slate-400 uppercase font-semibold">
            <tr>
              <th className="p-4">Tx ID</th>
              <th className="p-4">Sender</th>
              <th className="p-4">Recipient</th>
              <th className="p-4">Gross Amount</th>
              <th className="p-4">Fee (1.5%)</th>
              <th className="p-4">Net Settled</th>
              <th className="p-4">Timestamp</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1e2640]">
            {transfers && transfers.length > 0 ? (
              transfers.map((tx: any) => (
                <tr key={tx.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="p-4 font-mono text-blue-400">{tx.id?.slice(0, 8)}</td>
                  <td className="p-4">@{tx.sender?.username || 'User'}</td>
                  <td className="p-4">@{tx.recipient?.username || 'User'}</td>
                  <td className="p-4 font-mono">{Number(tx.gross_amount).toFixed(6)} {tx.asset_symbol}</td>
                  <td className="p-4 font-mono text-amber-400 font-bold">+{Number(tx.fee_amount).toFixed(6)} {tx.asset_symbol}</td>
                  <td className="p-4 font-mono text-emerald-400">{Number(tx.net_amount).toFixed(6)} {tx.asset_symbol}</td>
                  <td className="p-4 text-slate-400">
                    {tx.created_at ? new Date(tx.created_at).toLocaleString() : 'N/A'}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-500">
                  No internal transfers recorded in ledger yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
