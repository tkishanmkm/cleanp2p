"use client";

import React, { useState, useEffect } from 'react';
import { Info, X, Star, ThumbsUp, ThumbsDown, Lock, Unlock, AlertTriangle } from 'lucide-react';

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
  };
}

export default function TradeChatInfoPanel({ trade, currentUserId, counterparty }: TradeChatInfoPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [blockStatus, setBlockStatus] = useState<string>('NOT_BLOCKED');
  const [loading, setLoading] = useState(false);

  const isBuyer = currentUserId === trade.buyer_id;
  const displayName = isBuyer 
    ? trade.seller_display_name_snapshot 
    : trade.buyer_display_name_snapshot;

  const isTradeActiveOrDisputed = ['ACTIVE', 'DISPUTED'].includes(trade.status?.toUpperCase() || '');

  useEffect(() => {
    async function fetchRelationship() {
      try {
        const res = await fetch(`/api/user/block-status?targetId=${counterparty.id}`);
        const data = await res.json();
        if (data.status) setBlockStatus(data.status);
      } catch (e) {
        console.error('Failed to fetch block status:', e);
      }
    }
    if (isOpen && counterparty?.id) fetchRelationship();
  }, [isOpen, counterparty?.id]);

  const handleBlockToggle = async () => {
    setLoading(true);
    const action = (blockStatus === 'YOU_BLOCKED_THIS_USER' || blockStatus === 'BLOCKED_BOTH_WAYS') ? 'UNBLOCK' : 'BLOCK';

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
      }
    } catch (e) {
      console.error('Block toggle failed:', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:border-indigo-500/50 transition-all flex items-center gap-2 text-xs font-semibold cursor-pointer"
      >
        <Info className="h-4 w-4 text-indigo-400" />
        <span>Trade Info</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Info className="h-5 w-5 text-indigo-400" /> User Information
              </h3>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white bg-slate-800/50 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {blockStatus !== 'NOT_BLOCKED' && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                <span>
                  {blockStatus === 'YOU_BLOCKED_THIS_USER' && 'You Blocked This User'}
                  {blockStatus === 'THIS_USER_BLOCKED_YOU' && 'This User Blocked You'}
                  {blockStatus === 'BLOCKED_BOTH_WAYS' && 'Blocked Both Ways'}
                </span>
              </div>
            )}

            <div className="space-y-3">
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                {displayName && (
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Name:</span>
                    <span className="font-bold text-white">{displayName}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Username:</span>
                  <span className="font-mono text-indigo-400">@{counterparty.username}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Trading Currency:</span>
                  <span className="font-semibold text-white">{counterparty.currency}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <p className="text-slate-400">Rating</p>
                  <p className="text-base font-bold text-amber-400 flex items-center gap-1">
                    <Star className="h-4 w-4 fill-amber-400" /> {typeof counterparty.rating === 'number' ? counterparty.rating.toFixed(1) : '5.0'}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <p className="text-slate-400">Completed Trades</p>
                  <p className="text-base font-bold text-white">{counterparty.completedTrades ?? 0}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <p className="text-slate-400">Positive Feedback</p>
                  <p className="text-sm font-bold text-emerald-400 flex items-center gap-1">
                    <ThumbsUp className="h-3.5 w-3.5" /> {counterparty.positiveFeedback ?? 0}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <p className="text-slate-400">Negative Feedback</p>
                  <p className="text-sm font-bold text-rose-400 flex items-center gap-1">
                    <ThumbsDown className="h-3.5 w-3.5" /> {counterparty.negativeFeedback ?? 0}
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1 text-xs">
                <div className="flex justify-between text-slate-400">
                  <span>Completed trades with you:</span>
                  <span className="font-bold text-white">{counterparty.tradesWithYou ?? 0}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Has blocked:</span>
                  <span className="text-slate-200">{counterparty.usersBlockedCount ?? 0} users</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Blocked by:</span>
                  <span className="text-slate-200">{counterparty.usersBlockedByCount ?? 0} users</span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleBlockToggle}
              disabled={loading}
              className={`w-full py-3 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
                blockStatus === 'YOU_BLOCKED_THIS_USER' || blockStatus === 'BLOCKED_BOTH_WAYS'
                  ? 'bg-slate-800 hover:bg-slate-700 text-white'
                  : 'bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/30'
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
