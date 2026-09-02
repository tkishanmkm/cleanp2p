"use client";

import { useState } from "react";
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

export function DisputeTableClient({ initialDisputes }: { initialDisputes: any[] }) {
  const [selectedDispute, setSelectedDispute] = useState<any | null>(null);
  const [resolutionReason, setResolutionReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleResolve = async (winnerId: string) => {
    if (!selectedDispute) return;
    if (!resolutionReason.trim()) {
      alert("Please enter a resolution reason for audit logging.");
      return;
    }

    setIsSubmitting(true);
    try {
      await resolveDispute({
        disputeId: selectedDispute.id,
        tradeId: selectedDispute.trade_id,
        winnerId,
        resolutionReason,
      });
      setSelectedDispute(null);
      setResolutionReason("");
    } catch (err: any) {
      alert(`Resolution Error: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dispute ID / Trade</TableHead>
              <TableHead>Reason / Initiator</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialDisputes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                  No disputes recorded.
                </TableCell>
              </TableRow>
            ) : (
              initialDisputes.map((dispute) => (
                <TableRow key={dispute.id}>
                  <TableCell>
                    <div className="font-mono text-xs">{dispute.id}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      Trade: {dispute.trade_id}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-sm">{dispute.reason || "Unspecified claim"}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      By: {dispute.opened_by}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {dispute.trade?.amount} {dispute.trade?.crypto_currency} (${dispute.trade?.fiat_amount} {dispute.trade?.fiat_currency})
                  </TableCell>
                  <TableCell>
                    <Badge variant={dispute.status === "open" ? "destructive" : "secondary"}>
                      {dispute.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {dispute.status === "open" ? (
                      <Button size="sm" onClick={() => setSelectedDispute(dispute)}>
                        Review & Resolve
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground font-mono">Resolved</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Resolution Dialog Modal */}
      {selectedDispute && (
        <Dialog open={!!selectedDispute} onOpenChange={() => setSelectedDispute(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Resolve Trade Dispute</DialogTitle>
              <DialogDescription>
                Decide outcome for Trade <span className="font-mono">{selectedDispute.trade_id}</span>.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="p-3 bg-slate-100 dark:bg-slate-900 rounded text-xs font-mono space-y-1">
                <p><strong>Buyer ID:</strong> {selectedDispute.trade?.buyer_id}</p>
                <p><strong>Seller ID:</strong> {selectedDispute.trade?.seller_id}</p>
                <p><strong>Escrow Amount:</strong> {selectedDispute.trade?.amount} {selectedDispute.trade?.crypto_currency}</p>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Resolution Reason / Note:</label>
                <Textarea
                  placeholder="Provide detailed justification (e.g. 'Buyer provided proof of bank transfer receipt')."
                  value={resolutionReason}
                  onChange={(e) => setResolutionReason(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                disabled={isSubmitting}
                onClick={() => handleResolve(selectedDispute.trade?.buyer_id)}
              >
                Award to Buyer
              </Button>
              <Button
                variant="destructive"
                disabled={isSubmitting}
                onClick={() => handleResolve(selectedDispute.trade?.seller_id)}
              >
                Award to Seller
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
