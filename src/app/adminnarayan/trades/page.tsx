import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TradeActionButtons } from "./trade-action-buttons";
import { ArrowLeftRight, ShieldAlert, CheckCircle2, Clock } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminTradesPage() {
  const adminSupabase = createAdminClient();

  const { data: trades, error } = await adminSupabase
    .from("trades")
    .select(`
      *,
      buyer:profiles!buyer_id(full_name, user_id),
      seller:profiles!seller_id(full_name, user_id)
    `)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
          <ArrowLeftRight className="w-7 h-7 text-purple-400" />
          Trades & Escrow Oversight
        </h1>
        <p className="text-slate-400">
          Monitor marketplace transactions, resolve customer disputes, and manage locked escrows.
        </p>
      </div>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white">Active & Historical Trades ({trades?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-sm text-red-400">Failed to load trades: {error.message}</p>
          ) : !trades || trades.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">No trades recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="border-b border-slate-800 text-slate-400 uppercase text-xs">
                  <tr>
                    <th className="pb-3 px-2">Trade ID</th>
                    <th className="pb-3 px-2">Buyer / Seller</th>
                    <th className="pb-3 px-2">Amount</th>
                    <th className="pb-3 px-2">Status</th>
                    <th className="pb-3 px-2 text-right">Escrow Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {trades.map((trade) => (
                    <tr key={trade.id} className="hover:bg-slate-800/30">
                      <td className="py-3 px-2 font-mono text-xs text-slate-400">
                        {trade.id.slice(0, 8)}...
                      </td>
                      <td className="py-3 px-2">
                        <div className="text-xs">
                          <span className="text-slate-400">B: </span>
                          <span className="text-white font-medium">{trade.buyer?.full_name || "Unknown"}</span>
                        </div>
                        <div className="text-xs">
                          <span className="text-slate-400">S: </span>
                          <span className="text-white font-medium">{trade.seller?.full_name || "Unknown"}</span>
                        </div>
                      </td>
                      <td className="py-3 px-2 font-semibold text-emerald-400">
                        ${Number(trade.amount).toFixed(2)}
                      </td>
                      <td className="py-3 px-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full ${
                          trade.status === 'completed'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : trade.status === 'disputed'
                            ? 'bg-red-950 text-red-300 border border-red-800'
                            : 'bg-amber-950 text-amber-300 border border-amber-800'
                        }`}>
                          {trade.status}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-right">
                        <TradeActionButtons tradeId={trade.id} status={trade.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
