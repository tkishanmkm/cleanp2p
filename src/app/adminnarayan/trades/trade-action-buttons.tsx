"use client";

import Link from "next/link";
import { useTransition } from "react";
import { resolveTradeAction } from "./actions";
import { CheckCircle, RotateCcw, ExternalLink, Shield } from "lucide-react";

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

  return (
    <div className="flex items-center gap-2 justify-end">
      <Link
        href={`/adminnarayan/trades/${tradeId}`}
        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-purple-950/60 border border-purple-800 text-purple-300 hover:bg-purple-900/60 hover:text-white transition-colors"
      >
        <Shield className="w-3 h-3 text-purple-400" />
        Open / Moderate
      </Link>

      {status !== "completed" && status !== "cancelled" ? (
        <>
          <button
            onClick={() => handleAction("release")}
            disabled={isPending}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-emerald-950/50 border border-emerald-800 text-emerald-300 hover:bg-emerald-900/60 transition-colors disabled:opacity-50"
          >
            <CheckCircle className="w-3 h-3 text-emerald-400" />
            {isPending ? "Releasing..." : "Release"}
          </button>

          <button
            onClick={() => handleAction("refund")}
            disabled={isPending}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-amber-950/50 border border-amber-800 text-amber-300 hover:bg-amber-900/60 transition-colors disabled:opacity-50"
          >
            <RotateCcw className="w-3 h-3 text-amber-400" />
            {isPending ? "Refunding..." : "Refund"}
          </button>
        </>
      ) : (
        <span className="text-xs text-slate-500 italic">Resolved</span>
      )}
    </div>
  );
}
