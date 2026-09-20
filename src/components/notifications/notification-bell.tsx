'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  Bell, 
  CheckCheck, 
  Clock, 
  ArrowUpRight, 
  ArrowDownLeft, 
  DollarSign,
  ShieldAlert,
  ShieldCheck,
  MessageSquare,
  Lock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Send,
  Download,
  Timer
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

export function MiniCoinIcon({ symbol, className }: { symbol: string; className?: string }) {
  const s = (symbol || '').toUpperCase();
  const cls = className || 'h-3.5 w-3.5';
  switch (s) {
    case 'BTC':
      return <BtcLogo className={cls} />;
    case 'ETH':
      return <EthLogo className={cls} />;
    case 'USDT':
      return <UsdtLogo className={cls} />;
    case 'LTC':
      return <LtcLogo className={cls} />;
    case 'USDC':
      return <span className="font-bold text-[10px] text-blue-500">USDC</span>;
    default:
      return <span className="font-bold text-[10px]">{s}</span>;
  }
}

interface RecentTradeItem {
  id: string;
  trade_id_formatted: string;
  crypto_currency: string;
  fiat_currency: string;
  crypto_amount: number;
  fiat_amount: number;
  payment_method: string;
  status: string;
  created_at: string;
  expires_at_ms: number;
  buyer_id: string;
  seller_id: string;
  counterparty_username: string;
  counterparty_avatar: string | null;
  my_role: 'BUY' | 'SELL';
}

function parseActivityMeta(title?: string, message?: string) {
  const text = `${title || ''} ${message || ''}`.toLowerCase();
  
  // Coin detection
  let coinSymbol: string | null = null;
  if (text.includes('usdt')) coinSymbol = 'USDT';
  else if (text.includes('btc') || text.includes('bitcoin')) coinSymbol = 'BTC';
  else if (text.includes('eth') || text.includes('ethereum')) coinSymbol = 'ETH';
  else if (text.includes('ltc') || text.includes('litecoin')) coinSymbol = 'LTC';
  else if (text.includes('usdc')) coinSymbol = 'USDC';

  // Activity category detection
  if (text.includes('deposit') || text.includes('credited')) {
    return { category: 'deposit', coinSymbol, badgeColor: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' };
  }
  if (text.includes('withdraw') || text.includes('withdrawal')) {
    return { category: 'withdrawal', coinSymbol, badgeColor: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30' };
  }
  if (text.includes('transfer')) {
    return { category: 'transfer', coinSymbol, badgeColor: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30' };
  }
  if (text.includes('moderator') || text.includes('admin')) {
    return { category: 'moderator', coinSymbol, badgeColor: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30' };
  }
  if (text.includes('dispute') || text.includes('disputed')) {
    return { category: 'dispute', coinSymbol, badgeColor: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30' };
  }
  if (text.includes('release') || text.includes('completed')) {
    return { category: 'released', coinSymbol, badgeColor: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' };
  }
  if (text.includes('marked as paid') || text.includes('marked paid') || text.includes('payment marked')) {
    return { category: 'paid', coinSymbol, badgeColor: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30' };
  }
  if (text.includes('expired')) {
    return { category: 'expired', coinSymbol, badgeColor: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30' };
  }
  if (text.includes('cancel') || text.includes('cancelled') || text.includes('canceled')) {
    return { category: 'cancelled', coinSymbol, badgeColor: 'bg-rose-400/15 text-rose-500 dark:text-rose-300 border-rose-400/30' };
  }
  if (text.includes('trade') || text.includes('initiated') || text.includes('escrow')) {
    return { category: 'trade_initiated', coinSymbol, badgeColor: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30' };
  }

  return { category: 'general', coinSymbol, badgeColor: 'bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30' };
}

export function NotificationBell() {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
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
                  avatar_url: p.avatar_url || p.photo_url || `/api/media/avatar/${p.id}`,
                };
              });
            }
          }

          const now = Date.now();
          const formatted: RecentTradeItem[] = trades.map((t: any) => {
            const isBuyer = t.buyer_id === userId;
            const partnerId = isBuyer ? t.seller_id : t.buyer_id;
            const counterparty = profileMap[partnerId];
            const rawStatus = (t.status || '').toLowerCase();
            const escrowStatus = (t.escrow_status || '').toLowerCase();

            // Calculate precise, real-time effective status
            const isDisputed = Boolean(
              t.is_disputed ||
              rawStatus === 'disputed' ||
              rawStatus === 'dispute' ||
              escrowStatus === 'disputed'
            );
            const isCompleted = Boolean(
              t.completed_at ||
              t.released_at ||
              rawStatus === 'completed' ||
              rawStatus === 'released' ||
              escrowStatus === 'completed' ||
              escrowStatus === 'released'
            );
            const isCancelled = Boolean(
              t.cancelled_at ||
              rawStatus === 'cancelled' ||
              rawStatus === 'canceled' ||
              escrowStatus === 'cancelled'
            );
            const isPaid = Boolean(
              t.paid_at ||
              t.marked_paid_at ||
              t.payment_confirmed_at ||
              rawStatus === 'paid' ||
              rawStatus === 'mark_paid' ||
              rawStatus === 'buyer_marked_paid' ||
              escrowStatus === 'paid'
            );
            const isExplicitExpired = Boolean(
              t.expired_at ||
              rawStatus === 'expired' ||
              escrowStatus === 'expired'
            );

            const createdAtMs = t.created_at ? new Date(t.created_at).getTime() : 0;
            const winMin = Number(t.payment_window_minutes || t.payment_window || 30);
            const expiresAtMs = t.expires_at ? new Date(t.expires_at).getTime() : (createdAtMs > 0 ? createdAtMs + winMin * 60 * 1000 : 0);
            const isTimeExpired = (!isPaid && !isCompleted && !isDisputed) && (expiresAtMs > 0 && now >= expiresAtMs);

            let effectiveStatus = 'active';

            if (isDisputed) {
              effectiveStatus = 'disputed';
            } else if (isCompleted) {
              effectiveStatus = 'completed';
            } else if (isCancelled) {
              effectiveStatus = 'cancelled';
            } else if (isPaid) {
              effectiveStatus = 'paid';
            } else if (isExplicitExpired || isTimeExpired) {
              effectiveStatus = 'expired';
            } else if (rawStatus === 'active' || rawStatus === 'pending') {
              effectiveStatus = 'active';
            } else {
              effectiveStatus = rawStatus || 'active';
            }

            const rawTradeId = t.trade_id || t.id;
            const shortTradeId = '#' + (rawTradeId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();

            return {
              id: t.id,
              trade_id_formatted: shortTradeId,
              crypto_currency: (t.crypto || t.crypto_currency || t.asset_symbol || 'USDT').toUpperCase(),
              fiat_currency: (t.fiat_currency || t.fiat || 'USD').toUpperCase(),
              crypto_amount: Number(t.crypto_amount || t.amount || 0),
              fiat_amount: Number(t.fiat_amount || t.fiatAmount || 0),
              payment_method: t.payment_method || t.paymentMethod || 'Bank Transfer',
              status: effectiveStatus,
              created_at: t.created_at,
              expires_at_ms: expiresAtMs,
              buyer_id: t.buyer_id,
              seller_id: t.seller_id,
              counterparty_username: counterparty?.username || (isBuyer ? t.seller_username : t.buyer_username) || 'Trader',
              counterparty_avatar: counterparty?.avatar_url || null,
              my_role: isBuyer ? 'BUY' : 'SELL',
            };
          });

          setRecentTrades(formatted);
        }
      } catch (err) {
        console.warn('Recent trades fetch in bell notice:', err);
      } finally {
        setLoadingTrades(false);
      }
    }

    fetchRecentTrades();
  }, [userId]);

  const getStatusBadge = (status: string) => {
    switch ((status || '').toLowerCase()) {
      case 'active':
      case 'pending':
        return 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30';
      case 'paid':
      case 'buyer_marked_paid':
        return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30';
      case 'disputed':
      case 'dispute':
        return 'bg-amber-600/15 text-amber-700 dark:text-amber-300 border-amber-600/30 animate-pulse';
      case 'completed':
      case 'released':
        return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30';
      case 'expired':
        return 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30';
      case 'cancelled':
      case 'canceled':
        return 'bg-rose-400/15 text-rose-500 dark:text-rose-300 border-rose-400/30';
      default:
        return 'bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30';
    }
  };

  const getActivityIcon = (category: string, coinSymbol: string | null) => {
    switch (category) {
      case 'deposit':
        return (
          <div className="relative">
            <div className="h-8 w-8 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Download className="h-4 w-4" />
            </div>
            {coinSymbol && (
              <div className="absolute -bottom-1 -right-1 bg-white dark:bg-slate-900 rounded-full p-0.5 shadow-xs">
                <MiniCoinIcon symbol={coinSymbol} className="h-3 w-3" />
              </div>
            )}
          </div>
        );
      case 'withdrawal':
        return (
          <div className="relative">
            <div className="h-8 w-8 rounded-full bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Send className="h-4 w-4" />
            </div>
            {coinSymbol && (
              <div className="absolute -bottom-1 -right-1 bg-white dark:bg-slate-900 rounded-full p-0.5 shadow-xs">
                <MiniCoinIcon symbol={coinSymbol} className="h-3 w-3" />
              </div>
            )}
          </div>
        );
      case 'transfer':
        return (
          <div className="relative">
            <div className="h-8 w-8 rounded-full bg-sky-500/15 text-sky-600 dark:text-sky-400 flex items-center justify-center">
              <ArrowUpRight className="h-4 w-4" />
            </div>
            {coinSymbol && (
              <div className="absolute -bottom-1 -right-1 bg-white dark:bg-slate-900 rounded-full p-0.5 shadow-xs">
                <MiniCoinIcon symbol={coinSymbol} className="h-3 w-3" />
              </div>
            )}
          </div>
        );
      case 'moderator':
        return (
          <div className="h-8 w-8 rounded-full bg-purple-500/15 text-purple-600 dark:text-purple-400 flex items-center justify-center">
            <ShieldCheck className="h-4 w-4" />
          </div>
        );
      case 'dispute':
        return (
          <div className="h-8 w-8 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center">
            <ShieldAlert className="h-4 w-4" />
          </div>
        );
      case 'released':
        return (
          <div className="relative">
            <div className="h-8 w-8 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            {coinSymbol && (
              <div className="absolute -bottom-1 -right-1 bg-white dark:bg-slate-900 rounded-full p-0.5 shadow-xs">
                <MiniCoinIcon symbol={coinSymbol} className="h-3 w-3" />
              </div>
            )}
          </div>
        );
      case 'paid':
        return (
          <div className="relative">
            <div className="h-8 w-8 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <DollarSign className="h-4 w-4" />
            </div>
            {coinSymbol && (
              <div className="absolute -bottom-1 -right-1 bg-white dark:bg-slate-900 rounded-full p-0.5 shadow-xs">
                <MiniCoinIcon symbol={coinSymbol} className="h-3 w-3" />
              </div>
            )}
          </div>
        );
      case 'expired':
        return (
          <div className="h-8 w-8 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center">
            <Clock className="h-4 w-4" />
          </div>
        );
      case 'cancelled':
        return (
          <div className="h-8 w-8 rounded-full bg-rose-400/15 text-rose-500 dark:text-rose-300 flex items-center justify-center">
            <XCircle className="h-4 w-4" />
          </div>
        );
      case 'trade_initiated':
        return (
          <div className="relative">
            <div className="h-8 w-8 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <Lock className="h-4 w-4" />
            </div>
            {coinSymbol && (
              <div className="absolute -bottom-1 -right-1 bg-white dark:bg-slate-900 rounded-full p-0.5 shadow-xs">
                <MiniCoinIcon symbol={coinSymbol} className="h-3 w-3" />
              </div>
            )}
          </div>
        );
      default:
        return (
          <div className="h-8 w-8 rounded-full bg-slate-500/15 text-slate-600 dark:text-slate-400 flex items-center justify-center">
            <MessageSquare className="h-4 w-4" />
          </div>
        );
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Activity and notifications"
          className={cn(
            "relative p-2 rounded-full transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 cursor-pointer flex items-center justify-center",
            unreadCount > 0 
              ? "text-blue-600 dark:text-blue-400 ring-2 ring-blue-500/60 shadow-[0_0_15px_rgba(37,99,235,0.65)] bg-blue-50/80 dark:bg-blue-950/40 border border-blue-500/40"
              : "text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
          )}
        >
          <Bell className={cn("h-5 w-5", unreadCount > 0 && "animate-bounce duration-1000")} />
          
          {/* Active Activity Center Glow Badge */}
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-[18px] px-1 items-center justify-center text-[10px] font-extrabold text-white bg-blue-600 rounded-full shadow-md ring-2 ring-white dark:ring-[#0f1423] animate-pulse">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-[360px] sm:w-[410px] p-0 rounded-2xl bg-white dark:bg-[#0c101d] border border-slate-200 dark:border-[#1e2640] shadow-2xl overflow-hidden z-50 animate-in fade-in-50 zoom-in-95"
      >
        {/* Dropdown Header */}
        <div className="p-4 pb-3 border-b border-slate-100 dark:border-[#1e2640]/80">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="font-bold text-base text-slate-900 dark:text-white">Activity Center</span>
              {unreadCount > 0 && (
                <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
                  {unreadCount} new
                </span>
              )}
            </div>

            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => markAllAsRead()}
                className="h-7 text-xs px-2 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/50 flex items-center gap-1 font-medium"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                <span>Mark all read</span>
              </Button>
            )}
          </div>

          {/* Segmented Switcher Tabs */}
          <div className="grid grid-cols-2 p-1 bg-slate-100 dark:bg-[#151a2d] rounded-xl text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab('activity')}
              className={cn(
                "py-1.5 px-3 rounded-lg transition-all text-center flex items-center justify-center gap-1.5 cursor-pointer",
                activeTab === 'activity'
                  ? "bg-white dark:bg-[#07090e] text-slate-900 dark:text-white shadow-xs font-bold"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
              )}
            >
              <span>Activity Center</span>
              {unreadCount > 0 && (
                <span className="h-2 w-2 rounded-full bg-blue-600 inline-block" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('recent_trades')}
              className={cn(
                "py-1.5 px-3 rounded-lg transition-all text-center flex items-center justify-center gap-1.5 cursor-pointer",
                activeTab === 'recent_trades'
                  ? "bg-white dark:bg-[#07090e] text-slate-900 dark:text-white shadow-xs font-bold"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
              )}
            >
              <span>Recent Trades</span>
              {recentTrades.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  {recentTrades.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Content Section: 1. Activity Center Notifications */}
        {activeTab === 'activity' && (
          <div className="overflow-y-auto max-h-[400px] divide-y divide-slate-100 dark:divide-[#1e2640]/60">
            {notifications.length === 0 ? (
              <div className="p-10 text-center text-slate-400 dark:text-slate-500 text-sm">
                <Bell className="h-8 w-8 mx-auto mb-2 opacity-30 text-slate-400" />
                <p className="font-medium text-slate-600 dark:text-slate-400">No new notifications</p>
                <p className="text-xs text-slate-400 dark:text-slate-600 mt-0.5">
                  You'll see activity about trade milestones, deposits, and releases here.
                </p>
              </div>
            ) : (
              notifications.map((n) => {
                const meta = parseActivityMeta(n.title, n.message);
                let timeAgo = '';
                try {
                  timeAgo = formatDistanceToNow(new Date(n.createdAt), { addSuffix: true });
                } catch {
                  timeAgo = '';
                }

                const content = (
                  <div
                    onClick={() => {
                      if (!n.isRead) markAsRead(n.id);
                    }}
                    className={cn(
                      "flex items-start gap-3 p-3.5 transition-colors cursor-pointer",
                      !n.isRead 
                        ? "bg-blue-50/40 dark:bg-blue-950/20 hover:bg-blue-50/70 dark:hover:bg-blue-950/30" 
                        : "hover:bg-slate-50 dark:hover:bg-[#151a2d]/60"
                    )}
                  >
                    {/* Activity Icon with coin tag */}
                    <div className="shrink-0 mt-0.5">
                      {getActivityIcon(meta.category, meta.coinSymbol)}
                    </div>

                    {/* Text Body */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-xs text-slate-900 dark:text-white">
                            {n.title || 'System Notification'}
                          </span>
                          {meta.coinSymbol && (
                            <span className={cn('text-[10px] font-bold px-1.5 py-0.2 rounded border flex items-center gap-1', meta.badgeColor)}>
                              <MiniCoinIcon symbol={meta.coinSymbol} className="h-3 w-3" />
                              {meta.coinSymbol}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap">{timeAgo}</span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed line-clamp-2">
                        {n.message}
                      </p>
                    </div>

                    {!n.isRead && (
                      <span className="h-2 w-2 rounded-full bg-blue-600 shrink-0 mt-1.5 shadow-sm" />
                    )}
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
                          {trade.status === 'paid' ? 'Marked Paid' : trade.status}
                        </span>
                      </div>

                      {/* Crypto & Fiat Amount with Coin Logo */}
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
                          {trade.trade_id_formatted}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                        <span className="px-1.5 py-0.2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded text-[9px] font-medium truncate max-w-[110px]">
                          {trade.payment_method}
                        </span>
                        <span className="text-blue-600 dark:text-blue-400 font-medium hover:underline flex items-center gap-0.5">
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
