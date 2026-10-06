"use client";

import React, { useState, useMemo } from "react";
import { resolveDispute } from "./actions";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Scale,
  Search,
  MessageSquare,
  ShieldAlert,
  Clock,
  CheckCircle2,
  ExternalLink,
  DollarSign,
  Filter,
} from "lucide-react";
import Link from "next/link";

export function DisputeTableClient({ initialDisputes }: { initialDisputes: any[] }) {
  const [disputes, setDisputes] = useState<any[]>(initialDisputes);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "resolved">("all");
  const [selectedDispute, setSelectedDispute] = useState<any | null>(null);
  const [resolutionReason, setResolutionReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorFeedback, setErrorFeedback] = useState<string | null>(null);

  const filteredDisputes = useMemo(() => {
    return disputes.filter((d) => {
      const matchesStatus =
        statusFilter === "all" ? true : (d.status || "").toLowerCase() === statusFilter;

      if (!matchesStatus) return false;

      if (!searchQuery.trim()) return true;

      const q = searchQuery.toLowerCase().trim();
      const tradeId = (d.trade_id || "").toLowerCase();
      const disputeId = (d.id || "").toLowerCase();
      const reason = (d.reason || "").toLowerCase();
      const openedBy = (d.opened_by || "").toLowerCase();
      const buyerId = (d.trade?.buyer_id || "").toLowerCase();
      const sellerId = (d.trade?.seller_id || "").toLowerCase();

      return (
        tradeId.includes(q) ||
        disputeId.includes(q) ||
        reason.includes(q) ||
        openedBy.includes(q) ||
        buyerId.includes(q) ||
        sellerId.includes(q)
      );
    });
  }, [disputes, searchQuery, statusFilter]);

  const handleResolve = async (winnerId: string) => {
    if (!selectedDispute) return;
    if (!resolutionReason.trim()) {
      setErrorFeedback("Please enter a resolution reason for audit logging.");
      return;
    }

    setIsSubmitting(true);
    setErrorFeedback(null);
    try {
      await resolveDispute({
        disputeId: selectedDispute.id,
        tradeId: selectedDispute.trade_id,
        winnerId,
        resolutionReason,
      });

      setDisputes((prev) =>
        prev.map((d) =>
          d.id === selectedDispute.id
            ? { ...d, status: "resolved", winner_id: winnerId, resolution_reason: resolutionReason }
            : d
        )
      );
      setSelectedDispute(null);
      setResolutionReason("");
    } catch (err: any) {
      setErrorFeedback(err.message || "Failed to resolve dispute.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Controls: Search & Filter Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-900 border border-slate-800">
          <button
            onClick={() => setStatusFilter("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              statusFilter === "all" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            All Disputes ({disputes.length})
          </button>
          <button
            onClick={() => setStatusFilter("open")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              statusFilter === "open"
                ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Open &amp; Active ({disputes.filter((d) => (d.status || "").toLowerCase() === "open").length})
          </button>
          <button
            onClick={() => setStatusFilter("resolved")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              statusFilter === "resolved"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Resolved ({disputes.filter((d) => (d.status || "").toLowerCase() === "resolved").length})
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by trade ID, claim, user..."
            className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
          />
        </div>
      </div>

      {/* Disputes Table */}
      <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
        <Table>
          <TableHeader className="bg-slate-900/80 border-b border-slate-800">
            <TableRow>
              <TableHead className="text-slate-400 text-xs">Dispute / Trade ID</TableHead>
              <TableHead className="text-slate-400 text-xs">Claim / Initiator</TableHead>
              <TableHead className="text-slate-400 text-xs">Escrow Amount</TableHead>
              <TableHead className="text-slate-400 text-xs">Dispute Status</TableHead>
              <TableHead className="text-slate-400 text-xs text-right">Moderator Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-slate-800/60">
            {filteredDisputes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-10 text-slate-500 text-xs">
                  No dispute records found matching your filters.
                </TableCell>
              </TableRow>
            ) : (
              filteredDisputes.map((dispute) => {
                const isDisputeOpen = (dispute.status || "").toLowerCase() === "open";
                const tId = dispute.trade_id || dispute.trade?.id;

                return (
                  <TableRow key={dispute.id} className="hover:bg-slate-900/40 transition-colors">
                    <TableCell>
                      <div className="font-mono text-xs font-bold text-white">{dispute.id}</div>
                      <div className="text-[11px] text-amber-400 font-mono">
                        Trade: {dispute.trade_id}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-xs text-slate-200">{dispute.reason || "Unspecified claim"}</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        By: {dispute.opened_by || "Trader"}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <span className="font-bold text-emerald-400">
                        {dispute.trade?.amount || dispute.trade?.crypto_amount || "0.00"} {dispute.trade?.crypto_currency || "USDT"}
                      </span>
                      {dispute.trade?.fiat_amount && (
                        <div className="text-[10px] text-slate-400">
                          (${Number(dispute.trade?.fiat_amount).toLocaleString()} {dispute.trade?.fiat_currency || "USD"})
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                          isDisputeOpen
                            ? "bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse"
                            : "bg-slate-800 text-slate-400 border-slate-700"
                        }`}
                      >
                        {dispute.status || "open"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {tId && (
                          <Link
                            href={`/adminnarayan/disputes/${tId}`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-purple-300 hover:text-white rounded-lg border border-purple-900/60 text-xs font-semibold transition-colors"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            Moderator Room
                          </Link>
                        )}
                        {isDisputeOpen ? (
                          <Button
                            size="sm"
                            onClick={() => setSelectedDispute(dispute)}
                            className="bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold h-8"
                          >
                            Resolve Dispute
                          </Button>
                        ) : (
                          <span className="text-[11px] text-slate-500 font-mono">Resolved</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Resolution Dialog Modal */}
      {selectedDispute && (
        <Dialog open={!!selectedDispute} onOpenChange={() => setSelectedDispute(null)}>
          <DialogContent className="max-w-lg bg-slate-900 border border-slate-700 text-white">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold flex items-center gap-2">
                <Scale className="w-5 h-5 text-amber-400" /> Resolve Trade Dispute
              </DialogTitle>
              <DialogDescription className="text-slate-400 text-xs">
                Decide outcome for Trade <span className="font-mono text-amber-300">{selectedDispute.trade_id}</span>.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 text-xs">
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl font-mono space-y-1 text-slate-300">
                <p><strong>Buyer ID:</strong> {selectedDispute.trade?.buyer_id}</p>
                <p><strong>Seller ID:</strong> {selectedDispute.trade?.seller_id}</p>
                <p><strong>Escrow Amount:</strong> {selectedDispute.trade?.amount} {selectedDispute.trade?.crypto_currency}</p>
              </div>

              {errorFeedback && (
                <div className="p-2.5 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-300 text-xs">
                  {errorFeedback}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-300 block">Resolution Reason / Audit Justification:</label>
                <Textarea
                  placeholder="Provide detailed justification (e.g. 'Buyer provided validated proof of bank transfer receipt')."
                  value={resolutionReason}
                  onChange={(e) => setResolutionReason(e.target.value)}
                  className="bg-slate-950 border-slate-800 text-white text-xs focus:border-amber-500"
                />
              </div>
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
              <Button
                variant="outline"
                disabled={isSubmitting}
                onClick={() => handleResolve(selectedDispute.trade?.buyer_id)}
                className="bg-blue-600/90 hover:bg-blue-500 text-white text-xs font-semibold"
              >
                Award Escrow to Buyer
              </Button>
              <Button
                variant="destructive"
                disabled={isSubmitting}
                onClick={() => handleResolve(selectedDispute.trade?.seller_id)}
                className="bg-rose-600/90 hover:bg-rose-500 text-white text-xs font-semibold"
              >
                Award Escrow to Seller
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
