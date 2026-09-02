"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { TradeInitiationModal, AdData } from "@/components/p2p/trade-initiation-modal";

interface AdDetailTradeActionProps {
  ad: AdData;
}

export function AdDetailTradeAction({ ad }: AdDetailTradeActionProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div className="pt-6 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
      <div className="text-sm text-muted-foreground">
        Ready to trade? Crypto is locked in secure escrow until payment is confirmed.
      </div>
      <Button
        onClick={() => setIsModalOpen(true)}
        className="w-full sm:w-auto px-6 py-2.5 font-semibold bg-[#5D45F9] hover:bg-[#4833D8] text-white rounded-xl transition-colors shadow-sm"
      >
        {ad.type === "BUY" ? "Sell" : "Buy"} {ad.asset_symbol}
      </Button>

      <TradeInitiationModal
        ad={ad}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
}

export default AdDetailTradeAction;
