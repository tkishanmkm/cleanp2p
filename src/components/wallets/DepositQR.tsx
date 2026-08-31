'use client';

import { useState } from 'react';
import QRCode from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Copy, CheckCircle2, ShieldCheck } from "lucide-react";

interface DepositQRProps {
  address: string;
  chain?: string;
  asset?: string;
  minDeposit?: string;
  confirmations?: number;
  className?: string;
}

export function DepositQR({
  address,
  chain,
  asset,
  minDeposit,
  confirmations,
  className = '',
}: DepositQRProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    toast({ title: "Address Copied", description: "Deposit address copied to clipboard." });
    setTimeout(() => setCopied(false), 2500);
  };

  if (!address) {
    return null;
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* QR Code Container */}
      <div className="flex justify-center">
        <div className="p-3 bg-white rounded-xl border shadow-sm">
          <QRCode value={address} size={168} renderAs="svg" />
        </div>
      </div>

      {/* Address & Copy Action */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Deposit Address {chain ? `(${chain})` : ''}</span>
          {chain && (
            <Badge variant="outline" className="text-[10px] uppercase font-mono">
              {chain}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/60 border">
          <span className="font-mono text-xs break-all select-all flex-1 text-foreground">
            {address}
          </span>
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0 h-8 px-2.5"
            onClick={handleCopy}
          >
            {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            <span className="ml-1.5 text-xs">{copied ? "Copied" : "Copy"}</span>
          </Button>
        </div>
      </div>

      {/* Network Details */}
      {(minDeposit || confirmations) && (
        <div className="grid grid-cols-2 gap-2 text-xs p-3 rounded-lg bg-muted/40 border">
          {minDeposit && (
            <div>
              <span className="text-muted-foreground block">Minimum Deposit</span>
              <span className="font-semibold text-foreground">{minDeposit}</span>
            </div>
          )}
          {confirmations && (
            <div>
              <span className="text-muted-foreground block">Confirmations</span>
              <span className="font-semibold text-foreground">{confirmations} Blocks</span>
            </div>
          )}
        </div>
      )}

      {/* Confirmation Badge */}
      <div className="flex items-start gap-2.5 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:text-emerald-300 text-xs">
        <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          Deposits are detected and credited automatically once the required blockchain confirmations are reached.
        </span>
      </div>
    </div>
  );
}

export default DepositQR;
