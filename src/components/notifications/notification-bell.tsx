'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  Bell, 
  CheckCheck, 
  Clock, 
  ArrowUpRight, 
  ArrowDownLeft, 
  ExternalLink,
  DollarSign,
  ShieldAlert,
  MessageSquare,
  Sparkles,
  RefreshCw,
  Tag
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useNotifications } from '@/components/notifications-provider';
import { useAuth } from '@/components/providers/auth-provider';
import { createClient } from '@/lib/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { BtcLogo, EthLogo, LtcLogo, UsdtLogo } from '@/components/icons';

function MiniCoinIcon({ symbol }: { symbol: string }) {
  const s = (symbol || '').toUpperCase();
  switch (s) {
    case 'BTC':
      return <BtcLogo className="h-3.5 w-3.5" />;
    case 'ETH':
      return <EthLogo className="h-3.5 w-3.5" />;
    case 'USDT':
      return <UsdtLogo className="h-3.5 w-3.5" />;
    case 'LTC':
      return <LtcLogo className="h-3.5 w-3.5" />;
    default:
      return <span className="font-bold text-[10px]">{s}</span>;
  }
}

interface RecentTradeItem {
  id: string;
  crypto_currency: string;
  fiat_currency: string;
  crypto_amount: number;
  fiat_amount: number;
  status: string;
  created_at: string;
  buyer_id: string;
  seller_id: string;
  counterparty_username: string;
  counterparty_avatar: string | null;
  my_role: 'BUY' | 'SELL';
}

export function NotificationBell() {
  const { notifications, unreadCount, markAsRead, markAllAsRead, refreshNotifications } = useNotifications();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'activity' | 'recent_trades'>('activity');
  const [recentTrades, setRecentTrades] = useState<RecentTradeItem[]>([]);
  const [loadingTrades, setLoadingTrades] = useState(false);

  const userId = user?.id || (user as any)?.uid;

  useEffect(() => {
    if (!userId) return;

    async function fetchRecentTrades() {
      try {
        setLoadingTrades(true);
        const supabase = createClient();
        const { data: trades, error } = await supabase
          .from('trades')
          .select('*')
          .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
          .order('created_at', { ascending: false })
          .limit(10);

        if (!error && trades && trades.length > 0) {
          // Fetch profiles for all counterparty IDs
          const partnerIds = Array.from(
            new Set(
              trades
                .flatMap((t: any) => [t.buyer_id, t.seller_id])
                .filter((id: any) => id && id !== userId)
            )
          );

          let profileMap: Record<string, any> = {};
          if (partnerIds.length > 0) {
            const { data: profiles } = await supabase
              .from('profiles')
              .select('id, username, display_name, avatar_url, photo_url')
              .in('id', partnerIds);

            if (profiles) {
              profiles.forEach((p: any) => {
                profileMap[p.id] = {
                  username: p.username || p.display_name || 'Trader',
                  avatar_url: p.avatar_url || p.photo_url || null,
                };
              });
            }
          }

          const formatted: RecentTradeItem[] = trades.map((t: any) => {
            const isBuyer = t.buyer_id === userId;
            const partnerId = isBuyer ? t.seller_id : t.buyer_id;
            const counterparty = profileMap[partnerId];
            const rawStatus = (t.status || '').toLowerCase();
            const escrowStatus = (t.escrow_status || '').toLowerCase();

            // Calculate precise, real-time effective status
            let effectiveStatus = 'pending';

            if (
              t.is_disputed ||
              rawStatus === 'disputed' ||
              rawStatus === 'dispute' ||
              escrowStatus === 'disputed'
            ) {
              effectiveStatus = 'disputed';
            } else if (
              rawStatus === 'released' ||
              rawStatus === 'completed' ||
              escrowStatus === 'released' ||
              escrowStatus === 'completed' ||
              Boolean(t.released_at) ||
              Boolean(t.completed_at)
            ) {
              effectiveStatus = 'completed';
            } else if (
              rawStatus === 'cancelled' ||
              rawStatus === 'canceled' ||
              escrowStatus === 'cancelled' ||
              Boolean(t.cancelled_at)
            ) {
              effectiveStatus = 'cancelled';
            } else if (
              rawStatus === 'paid' ||
              rawStatus === 'mark_paid' ||
              rawStatus === 'buyer_marked_paid' ||
              rawStatus === 'payment_sent' ||
              escrowStatus === 'paid' ||
              Boolean(t.paid_at) ||
              Boolean(t.marked_paid_at) ||
              Boolean(t.payment_confirmed_at)
            ) {
              effectiveStatus = 'paid';
            } else if (
              rawStatus === 'expired' ||
              escrowStatus === 'expired' ||
              Boolean(t.expired_at)
            ) {
              effectiveStatus = 'expired';
            } else {
              // Check payment timer window expiration
              const createdAtMs = t.created_at ? new Date(t.created_at).getTime() : 0;
              const winMin = Number(t.payment_window_minutes || t.payment_window || 30);
              const expiresAtMs = t.expires_at
                ? new Date(t.expires_at).getTime()
                : (createdAtMs > 0 ? createdAtMs + winMin * 60 * 1000 : 0);

              if (expiresAtMs > 0 && Date.now() > expiresAtMs) {
                effectiveStatus = 'expired';
              } else {
                effectiveStatus = 'pending';
              }
            }

            return {
              id: t.id,
              crypto_currency: (t.crypto_currency || t.crypto || t.asset_symbol || 'USDT').toUpperCase(),
              fiat_currency: (t.fiat_currency || t.fiat || 'USD').toUpperCase(),
              crypto_amount: Number(t.crypto_amount ?? t.amount ?? 0),
              fiat_amount: Number(t.fiat_amount || 0),
              status: effectiveStatus,
              created_at: t.created_at,
              buyer_id: t.buyer_id,
              seller_id: t.seller_id,
              counterparty_username: counterparty?.username || (isBuyer ? 'Seller' : 'Buyer'),
              counterparty_avatar: counterparty?.avatar_url || null,
              my_role: isBuyer ? 'BUY' : 'SELL',
            };
          });
          setRecentTrades(formatted);
        } else {
          setRecentTrades([]);
        }
      } catch (err) {
        console.error('Failed to load recent trades for notification bell:', err);
      } finally {
        setLoadingTrades(false);
      }
    }

    fetchRecentTrades();
  }, [userId]);

  const getStatusBadge = (status: string) => {
    const s = (status || '').toLowerCase();
    switch (s) {
      case 'active':
        return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30';
      case 'pending':
      case 'awaiting_confirmation':
        return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30';
      case 'paid':
      case 'mark_paid':
      case 'payment_sent':
        return 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30';
      case 'disputed':
      case 'dispute':
        return 'bg-rose-600/15 text-rose-600 dark:text-rose-400 border-rose-600/30';
      case 'cancelled':
      case 'canceled':
        return 'bg-rose-400/15 text-rose-500 dark:text-rose-300 border-rose-400/30';
      case 'expired':
        return 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30 font-bold';
      case 'completed':
      case 'released':
      case 'credited':
      case 'confirmed':
        return 'bg-lime-500/15 text-lime-700 dark:text-lime-400 border-lime-500/30';
      default:
        return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30';
    }
  };

  const formatShortId = (id: string) => {
    const clean = (id || '').replace(/[^a-zA-Z0-9]/g, '');
    return clean.slice(0, 12).toUpperCase();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9 text-foreground cursor-pointer">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white shadow-sm animate-pulse">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
          <span className="sr-only">Toggle notifications</span>
        </Button>
      </DropdownMenuTrigger>
      
      <DropdownMenuContent align="end" className="w-84 sm:w-[410px] p-0 max-h-[540px] overflow-hidden flex flex-col bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] rounded-2xl shadow-2xl">
        {/* Header with Navigation Tabs */}
        <div className="p-3 border-b border-slate-200 dark:border-[#1e2640] bg-slate-50/70 dark:bg-[#07090e]/70">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <h4 className="font-bold text-sm text-slate-900 dark:text-white">Activity Center</h4>
              {unreadCount > 0 && (
                <span className="text-[11px] font-mono bg-amber-500/15 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full font-bold border border-amber-500/30">
                  {unreadCount} new
                </span>
              )}
            </div>
            {unreadCount > 0 && activeTab === 'activity' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => markAllAsRead()}
                className="text-[11px] h-6 px-2 text-slate-500 hover:text-slate-900 dark:hover:text-white"
              >
                <CheckCheck className="h-3 w-3 mr-1" />
                Mark all read
              </Button>
            )}
          </div>

          {/* Tabs Selector */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-200/60 dark:bg-[#151a2d] rounded-xl text-xs font-medium">
            <button
              type="button"
              onClick={() => setActiveTab('activity')}
              className={cn(
                'py-1.5 px-3 rounded-lg transition-all text-center cursor-pointer',
                activeTab === 'activity'
                  ? 'bg-white dark:bg-[#0f1423] text-slate-900 dark:text-white shadow-sm font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              )}
            >
              All Activity
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('recent_trades')}
              className={cn(
                'py-1.5 px-3 rounded-lg transition-all text-center cursor-pointer flex items-center justify-center gap-1.5',
                activeTab === 'recent_trades'
                  ? 'bg-white dark:bg-[#0f1423] text-slate-900 dark:text-white shadow-sm font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              )}
            >
              <span>Recent Trades</span>
              {recentTrades.length > 0 && (
                <span className="px-1.5 py-0.2 bg-slate-100 dark:bg-slate-800 rounded-full text-[10px]">
                  {recentTrades.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Content Section: 1. All Activity */}
        {activeTab === 'activity' && (
          <div className="overflow-y-auto max-h-[400px] divide-y divide-slate-100 dark:divide-[#1e2640]/60">
            {notifications.length === 0 ? (
              <div className="p-10 text-center text-slate-400 dark:text-slate-500 text-sm">
                <Bell className="h-8 w-8 mx-auto mb-2 opacity-30 text-slate-400" />
                <p className="font-medium text-slate-600 dark:text-slate-400">No activity yet</p>
                <p className="text-xs text-slate-400 dark:text-slate-600 mt-0.5">
                  Ad updates, trades, deposits, and messages will appear here.
                </p>
              </div>
            ) : (
              notifications.map((n) => {
                let timeAgo = '';
                try {
                  timeAgo = formatDistanceToNow(new Date(n.createdAt), { addSuffix: true });
                } catch {
                  timeAgo = '';
                }

                const content = (
                  <div
                    className={cn(
                      'flex items-start gap-3 p-3.5 transition-colors hover:bg-slate-50 dark:hover:bg-[#151a2d]/60 cursor-pointer',
                      !n.isRead && 'bg-amber-500/5 dark:bg-amber-500/10'
                    )}
                    onClick={() => {
                      if (!n.isRead) markAsRead(n.id);
                    }}
                  >
                    <Avatar className="h-9 w-9 shrink-0 border border-slate-200 dark:border-slate-700">
                      {n.senderPhotoURL && <AvatarImage src={n.senderPhotoURL} alt={n.senderUsername || 'Trader'} />}
                      <AvatarFallback className="bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold text-xs">
                        {n.senderUsername ? n.senderUsername.substring(0, 2).toUpperCase() : 'PX'}
                      </AvatarFallback>
                    </Avatar>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-xs font-bold truncate text-slate-900 dark:text-white">
                          {n.title || (n.senderUsername ? `@${n.senderUsername}` : 'Notification')}
                        </p>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap">{timeAgo}</span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed line-clamp-2">
                        {n.message}
                      </p>
                    </div>
                  </div>
                );

                if (n.link) {
                  return (
                    <Link key={n.id} href={n.link} className="block">
                      {content}
                    </Link>
                  );
                }

                return <div key={n.id}>{content}</div>;
              })
            )}
          </div>
        )}

        {/* Content Section: 2. Recent Trades */}
        {activeTab === 'recent_trades' && (
          <div className="overflow-y-auto max-h-[400px] divide-y divide-slate-100 dark:divide-[#1e2640]/60">
            {loadingTrades ? (
              <div className="p-8 text-center text-slate-400 text-xs">Loading recent trades...</div>
            ) : recentTrades.length === 0 ? (
              <div className="p-10 text-center text-slate-400 dark:text-slate-500 text-sm">
                <Clock className="h-8 w-8 mx-auto mb-2 opacity-30 text-slate-400" />
                <p className="font-medium text-slate-600 dark:text-slate-400">No recent trades</p>
                <p className="text-xs text-slate-400 dark:text-slate-600 mt-0.5">
                  Your active and completed P2P trades will appear here.
                </p>
              </div>
            ) : (
              recentTrades.map((trade) => {
                let timeAgo = '';
                try {
                  timeAgo = formatDistanceToNow(new Date(trade.created_at), { addSuffix: true });
                } catch {
                  timeAgo = '';
                }

                return (
                  <Link
                    key={trade.id}
                    href={`/trade/${trade.id}`}
                    className="flex items-start gap-3 p-3.5 transition-colors hover:bg-slate-50 dark:hover:bg-[#151a2d]/60 cursor-pointer block"
                  >
                    {/* Counterparty Avatar */}
                    <Avatar className="h-10 w-10 shrink-0 border border-slate-200 dark:border-slate-700">
                      {trade.counterparty_avatar && (
                        <AvatarImage src={trade.counterparty_avatar} alt={trade.counterparty_username} />
                      )}
                      <AvatarFallback className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs">
                        {trade.counterparty_username.substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>

                    {/* Trade Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 truncate">
                          <span className={cn(
                            'text-[10px] font-bold px-1.5 py-0.2 rounded',
                            trade.my_role === 'BUY'
                              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                              : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                          )}>
                            {trade.my_role}
                          </span>
                          <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            @{trade.counterparty_username}
                          </span>
                        </div>

                        {/* Status Badge */}
                        <span className={cn(
                          'text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize',
                          getStatusBadge(trade.status)
                        )}>
                          {trade.status}
                        </span>
                      </div>

                      {/* Crypto & Fiat Amount */}
                      <div className="flex items-center justify-between mt-1.5">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-white">
                          <MiniCoinIcon symbol={trade.crypto_currency} />
                          <span>{trade.crypto_amount} {trade.crypto_currency}</span>
                          <span className="text-slate-400 dark:text-slate-500 font-normal">≈</span>
                          <span className="text-slate-600 dark:text-slate-300 font-mono">
                            {trade.fiat_amount.toLocaleString()} {trade.fiat_currency}
                          </span>
                        </div>

                        <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                          #{formatShortId(trade.id)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                        <span>{timeAgo}</span>
                        <span className="text-amber-600 dark:text-amber-400 font-medium hover:underline flex items-center gap-0.5">
                          Open Trade →
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default NotificationBell;
