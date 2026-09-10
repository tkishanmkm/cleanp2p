"use client";

import React, { useState, useEffect } from 'react';
import { 
  Info, 
  X, 
  Star, 
  ThumbsUp, 
  ThumbsDown, 
  Lock, 
  Unlock, 
  AlertTriangle,
  MailCheck,
  ShieldCheck,
  CheckCircle2
} from 'lucide-react';
import { formatTradeDisplayName } from '@/lib/name-utils';

interface TradeChatInfoPanelProps {
  trade: {
    id: string;
    status: 'ACTIVE' | 'DISPUTED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED' | string;
    buyer_id: string;
    seller_id: string;
    buyer_display_name_snapshot?: string;
    seller_display_name_snapshot?: string;
  };
  currentUserId: string;
  counterparty: {
    id: string;
    username: string;
    rating: number;
    completedTrades: number;
    tradesWithYou: number;
    positiveFeedback: number;
    negativeFeedback: number;
    usersBlockedByCount: number;
    usersBlockedCount: number;
    currency: string;
    is_email_verified?: boolean;
    is_id_verified?: boolean;
    kyc_status?: string;
  };
}

export default function TradeChatInfoPanel({ trade, currentUserId, counterparty }: TradeChatInfoPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [blockStatus, setBlockStatus] = useState<string>('NOT_BLOCKED');
  const [loading, setLoading] = useState(false);
  const [detailedProfile, setDetailedProfile] = useState<any>(null);
  const [liveBlockedByCount, setLiveBlockedByCount] = useState<number>(counterparty.usersBlockedByCount ?? 0);
  const [liveBlockedCount, setLiveBlockedCount] = useState<number>(counterparty.usersBlockedCount ?? 0);

  const isBuyer = currentUserId === trade.buyer_id;
  const rawDisplayName = isBuyer 
    ? trade.seller_display_name_snapshot 
    : trade.buyer_display_name_snapshot;

  const visibility = (counterparty as any).name_visibility || (counterparty as any).nameVisibility || 'FULL';
  const nameDisplay = formatTradeDisplayName(rawDisplayName, visibility);

  const isTradeActiveOrDisputed = ['ACTIVE', 'DISPUTED'].includes(trade.status?.toUpperCase() || '');

  useEffect(() => {
    async function fetchRelationship() {
      try {
        const res = await fetch(`/api/user/block-status?targetId=${counterparty.id}`);
        const data = await res.json();
        if (data.status) setBlockStatus(data.status);
        if (typeof data.blockedByCount === 'number') {
          setLiveBlockedByCount(data.blockedByCount);
        }
        if (typeof data.usersBlockedCount === 'number') {
          setLiveBlockedCount(data.usersBlockedCount);
        }
      } catch (e) {
        console.error('Failed to fetch block status:', e);
      }

      try {
        const res = await fetch(`/api/user/profile?username=${encodeURIComponent(counterparty.username)}`);
        const data = await res.json();
        if (data.profile) setDetailedProfile(data.profile);
      } catch (e) {
        console.error('Failed to fetch detailed profile:', e);
      }
    }
    if (isOpen && counterparty?.id) fetchRelationship();
  }, [isOpen, counterparty?.id, counterparty?.username]);

  const handleBlockToggle = async () => {
    setLoading(true);
    const isCurrentlyBlocked = (blockStatus === 'YOU_BLOCKED_THIS_USER' || blockStatus === 'BLOCKED_BOTH_WAYS');
    const action = isCurrentlyBlocked ? 'UNBLOCK' : 'BLOCK';

    try {
      const res = await fetch('/api/user/block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: counterparty.id,
          action,
          activeTradeId: isTradeActiveOrDisputed ? trade.id : null,
        }),
      });

      if (res.ok) {
        setBlockStatus(action === 'BLOCK' ? 'YOU_BLOCKED_THIS_USER' : 'NOT_BLOCKED');
        setLiveBlockedByCount((prev) => (action === 'BLOCK' ? prev + 1 : Math.max(0, prev - 1)));
      }
    } catch (e) {
      console.error('Block toggle failed:', e);
    } finally {
      setLoading(false);
    }
  };

  const isEmailVerified = Boolean(detailedProfile?.is_email_verified ?? true);
  const isIdVerified = Boolean(
    detailedProfile?.is_id_verified || 
    detailedProfile?.kyc_status === 'VERIFIED' || 
    counterparty?.is_id_verified ||
    counterparty?.kyc_status === 'VERIFIED'
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:border-amber-500/50 transition-all flex items-center gap-2 text-xs font-semibold cursor-pointer"
        title="Trader Information & Safety"
      >
        <Info className="h-4 w-4 text-amber-400" />
        <span>Trade Info</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] p-6 shadow-2xl space-y-5 text-slate-900 dark:text-white">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#1e2640] pb-4">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Info className="h-5 w-5 text-amber-500" /> User Information
              </h3>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800/50 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {blockStatus !== 'NOT_BLOCKED' && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-300 text-xs flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                <span>
                  {blockStatus === 'YOU_BLOCKED_THIS_USER' && 'You Blocked This User'}
                  {blockStatus === 'THIS_USER_BLOCKED_YOU' && 'This User Blocked You'}
                  {blockStatus === 'BLOCKED_BOTH_WAYS' && 'Blocked Both Ways'}
                </span>
              </div>
            )}

            <div className="space-y-3">
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-[#07090e] border border-slate-200 dark:border-[#1e2640] space-y-2">
                {!nameDisplay.isHidden && nameDisplay.formattedName && (
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 dark:text-slate-400">{nameDisplay.type === 'PARTIAL' ? 'Name (Partial):' : 'Full Name:'}</span>
                    <span className="font-bold text-slate-900 dark:text-white">{nameDisplay.formattedName}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs items-center">
                  <span className="text-slate-500 dark:text-slate-400">Username:</span>
                  <span className="font-mono font-bold text-amber-600 dark:text-amber-400">@{counterparty.username}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400">Trading Currency:</span>
                  <span className="font-semibold text-slate-900 dark:text-white">{counterparty.currency}</span>
                </div>

                {/* Verification Flags */}
                <div className="flex items-center gap-2 pt-1 border-t border-slate-200 dark:border-[#1e2640]/60">
                  {isEmailVerified && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      <MailCheck className="h-3 w-3" />
                      Email Verified
                    </span>
                  )}
                  {isIdVerified ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                      <ShieldCheck className="h-3 w-3" />
                      ID Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                      Tier 1 Trader
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#07090e] border border-slate-200 dark:border-[#1e2640] space-y-1">
                  <p className="text-slate-500 dark:text-slate-400">Rating</p>
                  <p className="text-base font-bold text-amber-500 flex items-center gap-1">
                    <Star className="h-4 w-4 fill-amber-500" /> {typeof counterparty.rating === 'number' ? counterparty.rating.toFixed(1) : '5.0'}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#07090e] border border-slate-200 dark:border-[#1e2640] space-y-1">
                  <p className="text-slate-500 dark:text-slate-400">Completed Trades</p>
                  <p className="text-base font-bold text-slate-900 dark:text-white">{counterparty.completedTrades ?? 0}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#07090e] border border-slate-200 dark:border-[#1e2640] space-y-1">
                  <p className="text-slate-500 dark:text-slate-400">Positive Feedback</p>
                  <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <ThumbsUp className="h-3.5 w-3.5" /> {counterparty.positiveFeedback ?? 0}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#07090e] border border-slate-200 dark:border-[#1e2640] space-y-1">
                  <p className="text-slate-500 dark:text-slate-400">Negative Feedback</p>
                  <p className="text-sm font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                    <ThumbsDown className="h-3.5 w-3.5" /> {counterparty.negativeFeedback ?? 0}
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50/70 dark:bg-[#07090e]/70 border border-slate-200 dark:border-[#1e2640]/80 space-y-1 text-xs">
                <div className="flex justify-between text-slate-500 dark:text-slate-400">
                  <span>Completed trades with you:</span>
                  <span className="font-bold text-slate-900 dark:text-white">{counterparty.tradesWithYou ?? 0}</span>
                </div>
                <div className="flex justify-between text-slate-500 dark:text-slate-400">
                  <span>Has blocked:</span>
                  <span className="text-slate-700 dark:text-slate-200">{liveBlockedCount} users</span>
                </div>
                <div className="flex justify-between text-slate-500 dark:text-slate-400">
                  <span>Blocked by:</span>
                  <span className="text-slate-700 dark:text-slate-200">{liveBlockedByCount} users</span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleBlockToggle}
              disabled={loading}
              className={`w-full py-3 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
                blockStatus === 'YOU_BLOCKED_THIS_USER' || blockStatus === 'BLOCKED_BOTH_WAYS'
                  ? 'bg-slate-800 hover:bg-slate-700 text-white shadow-sm'
                  : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30'
              }`}
            >
              {(blockStatus === 'YOU_BLOCKED_THIS_USER' || blockStatus === 'BLOCKED_BOTH_WAYS') ? (
                <><Unlock className="h-4 w-4" /> Unblock User</>
              ) : (
                <><Lock className="h-4 w-4" /> Block User</>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
