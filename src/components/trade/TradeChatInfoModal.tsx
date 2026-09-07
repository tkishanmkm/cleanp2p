'use client';

import React from 'react';
import { getTradeChatDisplayName, getPublicHandle } from '@/utils/userPrivacy';
import { X, User, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TradeChatInfoModalProps {
  user?: {
    full_name?: string | null;
    username?: string | null;
    name_privacy?: string | null;
    rating?: number;
    completed_trades?: number;
    positive_feedback?: number;
    negative_feedback?: number;
  } | null;
  onClose: () => void;
}

export default function TradeChatInfoModal({ user, onClose }: TradeChatInfoModalProps) {
  if (!user) return null;

  const displayName = getTradeChatDisplayName(user);
  const handle = getPublicHandle(user.username);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-[#9273FC]" />
            <h3 className="text-base font-bold text-foreground">Trading Partner Info</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Full / Partial Name displayed ONLY here based on user privacy */}
        <div className="p-4 rounded-xl bg-muted/40 border border-border/80 space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block">
            Partner Identity
          </span>
          <h2 className="text-lg font-bold text-foreground">{displayName}</h2>
          {handle && displayName !== handle && (
            <span className="text-xs font-mono text-[#9273FC] block">{handle}</span>
          )}
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={onClose} variant="secondary" className="px-5">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
