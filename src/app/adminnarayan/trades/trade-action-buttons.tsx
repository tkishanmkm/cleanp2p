"use client";

import { useTransition } from "react";
import { resolveTradeAction } from "./actions";
import { CheckCircle, RotateCcw } from "lucide-react";

interface TradeActionButtonsProps {
  tradeId: string;
  status: string;
}

export function TradeActionButtons({ tradeId, status }: TradeActionButtonsProps) {
  const [isPending, startTransition] = useTransition();

  const handleAction = (action: "release" | "refund") => {
    const confirmMessage = action === "release" 
      ? "Are you sure you want to release escrow funds to the seller?"
      : "Are you sure you want to refund escrow funds to the buyer?";

    if (confirm(confirmMessage)) {
      startTransition(async () => {
        const res = await resolveTradeAction(tradeId, action);
        if (res?.error) {
          alert(`Error processing trade: ${res.error}`);
        }
      });
    }
  };

  if (status === "completed" || status === "cancelled") {
    return <span className="text-xs text-slate-500 italic">Resolved</span>;
  }

  return (
    <div className="flex items-center gap-2 justify-end">
      <button
        onClick={() => handleAction("release")}
        disabled={isPending}
        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-emerald-950/50 border border-emerald-800 text-emerald-300 hover:bg-emerald-900/60 transition-colors disabled:opacity-50"
      >
        <CheckCircle className="w-3 h-3 text-emerald-400" />
        {isPending ? "Releasing..." : "Release Escrow"}
      </button>

      <button
        onClick={() => handleAction("refund")}
        disabled={isPending}
        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-amber-950/50 border border-amber-800 text-amber-300 hover:bg-amber-900/60 transition-colors disabled:opacity-50"
      >
        <RotateCcw className="w-3 h-3 text-amber-400" />
        {isPending ? "Refunding..." : "Refund Buyer"}
      </button>
    </div>
  );
}
