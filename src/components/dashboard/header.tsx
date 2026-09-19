'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Bell,
  Menu,
  FileText,
  LogOut,
  User,
  Settings,
  Globe,
  ChevronDown,
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  LifeBuoy,
  Mail,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldAlert,
  MessageSquare,
  Shield,
  Tag,
  ThumbsUp,
  ThumbsDown,
  Timer,
  CheckCheck,
} from 'lucide-react';
import {
  HdDashboardIcon,
  HdWalletsIcon,
  HdBuyCoinIcon,
  HdSellCoinIcon,
  HdTransferIcon,
  HdCreateAdIcon,
  HdMyAdsIcon,
  HdMyTradesIcon,
  HdSupportIcon,
  HdProfileIcon,
  HdSettingsIcon,
  HdTicketsIcon,
} from '@/components/hd-nav-icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useNotifications } from '@/components/notifications-provider';
import { useAuth } from '@/components/providers/auth-provider';
import { Logo } from '@/components/logo';
import { ModeToggle } from '@/components/mode-toggle';
import { BtcLogo, EthLogo, LtcLogo, UsdtLogo, DefaultAvatar } from '../icons';
import { Badge } from '../ui/badge';
import type { Language, Trade, CryptoCurrency, Notification } from '@/lib/types';
import { Skeleton } from '../ui/skeleton';
import { cn, toDate } from '@/lib/utils';
import { usePrices } from '@/context/price-context';
import { useWallet } from '@/context/wallet-context';
import { useToast } from '@/hooks/use-toast';
import { useStopwatch, formatTime } from '@/hooks/use-stopwatch';
import { LANGUAGES } from '@/lib/constants';
import { FlagIcon } from '../ui/flag-icon';
import { useI18n } from '@/context/i18n-context';
import { ScrollArea } from '../ui/scroll-area';
import { useState, useEffect } from 'react';
import { statusColors } from '@/lib/status-colors';
import { supabase } from '@/lib/supabase/client';
import { NavbarWallet } from '@/components/dashboard/NavbarWallet';

type NavItem = {
  href: string;
  label: string;
  shortDesc: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
};

const navItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', shortDesc: 'Overview & metrics', icon: HdDashboardIcon },
  { href: '/wallets', label: 'Wallets', shortDesc: 'Balances & deposits', icon: HdWalletsIcon },
  { href: '/buy', label: 'Buy Coin', shortDesc: 'Instant P2P purchase', icon: HdBuyCoinIcon },
  { href: '/sell', label: 'Sell Coin', shortDesc: 'Cash out crypto', icon: HdSellCoinIcon },
  { href: '/transfer', label: 'Transfer', shortDesc: 'Internal instant send', icon: HdTransferIcon },
  { href: '/ads/create', label: 'Create Ad', shortDesc: 'Post custom offers', icon: HdCreateAdIcon, badge: 'Post' },
  { href: '/my-ads', label: 'My Ads', shortDesc: 'Manage your listings', icon: HdMyAdsIcon },
  { href: '/trades', label: 'My Trades', shortDesc: 'Active escrow trades', icon: HdMyTradesIcon },
  { href: '/support', label: 'Support', shortDesc: '24/7 help desk', icon: HdSupportIcon },
];

const CryptoLogo = ({ crypto, className }: { crypto?: string; className?: string }) => {
  const norm = (crypto || 'BTC').toUpperCase();
  switch (norm) {
    case 'BTC':
    case 'BITCOIN':
      return <BtcLogo className={className} />;
    case 'ETH':
    case 'ETHEREUM':
      return <EthLogo className={className} />;
    case 'LTC':
    case 'LITECOIN':
      return <LtcLogo className={className} />;
    case 'USDT':
    case 'TETHER':
      return <UsdtLogo className={className} />;
    default:
      return <BtcLogo className={className} />;
  }
};

const formatDateArial = (dateVal: any): string => {
  const d = toDate(dateVal);
  if (!d) return 'N/A';
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const year = String(d.getFullYear()).slice(-2);
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${month}/${day}/${year}, ${hours}:${minutes} ${ampm}`;
};

function getActivityIcon(message: string) {
  const m = (message || '').toLowerCase();
  if (m.includes('completed') || m.includes('released') || m.includes('sold') || m.includes('bought')) {
    return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />;
  }
  if (m.includes('cancelled') || m.includes('canceled')) {
    return <XCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />;
  }
  if (m.includes('expired')) {
    return <Clock className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />;
  }
  if (m.includes('dispute') || m.includes('disputed')) {
    return <ShieldAlert className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />;
  }
  if (m.includes('feedback') || m.includes('positive') || m.includes('negative')) {
    return m.includes('negative') ? (
      <ThumbsDown className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
    ) : (
      <ThumbsUp className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
    );
  }
  if (m.includes('moderator') || m.includes('support') || m.includes('admin')) {
    return <Shield className="h-4 w-4 text-purple-500 shrink-0 mt-0.5" />;
  }
  if (m.includes('ad created') || m.includes('offer')) {
    return <Tag className="h-4 w-4 text-indigo-500 shrink-0 mt-0.5" />;
  }
  if (m.includes('message') || m.includes('chat')) {
    return <MessageSquare className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />;
  }
  return <ArrowLeftRight className="h-4 w-4 text-primary shrink-0 mt-0.5" />;
}

function RecentTradeNotificationRow({ trade, currentUserId }: { trade: any; currentUserId?: string }) {
  const isBuyer = (trade.buyerId || trade.buyer_id) === currentUserId;
  const partner = isBuyer ? trade.seller : trade.buyer;
  const partnerUsername = partner?.username || (isBuyer ? trade.seller_username : trade.buyer_username) || 'Trader';
  const partnerId = isBuyer ? (trade.sellerId || trade.seller_id) : (trade.buyerId || trade.buyer_id);
  const partnerAvatar = partner?.avatar_url || partner?.photo_url || (partnerId ? `/api/media/avatar/${partnerId}` : null);
  const rawCoin = trade.crypto || trade.cryptocurrency || trade.coin_symbol || trade.coin || trade.asset || 'BTC';
  const coin = rawCoin.toUpperCase();
  const amount = Number(trade.amount || 0);
  const fiatAmount = Number(trade.fiatAmount || trade.fiat_amount || 0);
  const fiatCurrency = trade.fiatCurrency || trade.fiat_currency || 'USD';
  const paymentMethod = trade.paymentMethod || trade.payment_method || 'Bank Transfer';
  const tradeIdFormatted = trade.tradeId || (trade.id ? '#' + trade.id.replace(/-/g, '').slice(0, 8).toUpperCase() : '');

  // Calculate precise, real-time effective status
  const rawStatus = (trade.status || '').toLowerCase();
  const escrowStatus = (trade.escrow_status || '').toLowerCase();
  const isDisputed = Boolean(trade.is_disputed || rawStatus === 'disputed' || rawStatus === 'dispute' || escrowStatus === 'disputed');
  const isCompleted = Boolean(trade.completed_at || trade.released_at || rawStatus === 'completed' || rawStatus === 'released' || escrowStatus === 'completed' || escrowStatus === 'released');
  const isCancelled = Boolean(trade.cancelled_at || rawStatus === 'cancelled' || rawStatus === 'canceled' || escrowStatus === 'cancelled');
  const isPaid = Boolean(trade.paid_at || trade.marked_paid_at || trade.payment_confirmed_at || rawStatus === 'paid' || rawStatus === 'mark_paid' || rawStatus === 'buyer_marked_paid' || escrowStatus === 'paid');
  const isExplicitExpired = Boolean(trade.expired_at || rawStatus === 'expired' || escrowStatus === 'expired');

  const createdAtMs = trade.createdAt || trade.created_at ? new Date(trade.createdAt || trade.created_at).getTime() : 0;
  const winMin = Number(trade.payment_window_minutes || trade.payment_window || 30);
  const expiresAtMs = trade.expires_at || trade.expiresAt ? new Date(trade.expires_at || trade.expiresAt).getTime() : (createdAtMs > 0 ? createdAtMs + winMin * 60 * 1000 : 0);
  const isTimeExpired = (!isPaid && !isCompleted && !isDisputed) && (expiresAtMs > 0 && Date.now() >= expiresAtMs);

  let effectiveStatus = 'pending';
  if (isDisputed) effectiveStatus = 'disputed';
  else if (isCompleted) effectiveStatus = 'completed';
  else if (isCancelled) effectiveStatus = 'cancelled';
  else if (isPaid) effectiveStatus = 'paid';
  else if (isExplicitExpired || isTimeExpired) effectiveStatus = 'expired';
  else effectiveStatus = 'pending';

  const isActive = effectiveStatus === 'pending' && !isTimeExpired;
  const remainingSeconds = Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));

  return (
    <DropdownMenuItem asChild className="p-0 focus:bg-accent/40 rounded-xl">
      <Link
        href={`/trade/${trade.id}`}
        className="flex flex-col gap-2 p-2.5 hover:bg-slate-100/80 dark:hover:bg-slate-800/80 rounded-xl transition-all border border-border/40 hover:border-primary/40 bg-card mb-1.5 shadow-xs"
      >
        {/* Row 1: Counterparty DP, username, roles, and status badge */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Avatar className="h-8 w-8 rounded-lg shrink-0 border border-border/80 overflow-hidden">
              {partnerAvatar ? (
                <AvatarImage src={partnerAvatar} alt={partnerUsername} className="object-cover" />
              ) : null}
              <AvatarFallback className="bg-primary/10 text-primary font-bold text-xs">
                {partnerUsername.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-bold text-foreground truncate">
                @{partnerUsername}
              </span>
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-medium">
                <span className={cn('font-bold', isBuyer ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                  You: {isBuyer ? 'Buyer' : 'Seller'}
                </span>
                <span>•</span>
                <span>Partner: {isBuyer ? 'Seller' : 'Buyer'}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end shrink-0 gap-0.5">
            <Badge
              variant="outline"
              className={cn(
                'capitalize text-[10px] px-2 py-0.5 font-bold font-mono',
                statusColors[effectiveStatus as keyof typeof statusColors] || 'border-border'
              )}
            >
              {effectiveStatus === 'paid' ? 'Mark Paid' : effectiveStatus === 'disputed' ? 'Disputed' : effectiveStatus}
            </Badge>
            {isActive && remainingSeconds > 0 && (
              <span className="text-[10px] font-mono text-amber-600 dark:text-amber-400 font-bold flex items-center gap-0.5">
                <Timer className="h-3 w-3 animate-spin" />
                {formatTime(remainingSeconds)}
              </span>
            )}
          </div>
        </div>

        {/* Row 2: Coin Amount, Coin Icon, Fiat Amount, Payment Method, Trade ID */}
        <div className="flex items-center justify-between text-xs pt-1.5 border-t border-border/40 text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className="font-[Arial,Helvetica,sans-serif] tabular-nums font-bold text-foreground">
              {amount.toFixed(4)} {coin}
            </span>
            <CryptoLogo crypto={coin} className="h-3.5 w-3.5" />
            <span className="text-[11px] font-bold text-muted-foreground">
              ({fiatAmount.toLocaleString()} {fiatCurrency})
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-[10px]">
            <span className="bg-muted/80 border border-border/50 px-1.5 py-0.5 rounded text-foreground font-medium truncate max-w-[100px]">
              {paymentMethod}
            </span>
            <span className="font-mono text-primary font-bold">
              {tradeIdFormatted}
            </span>
          </div>
        </div>
      </Link>
    </DropdownMenuItem>
  );
}

export function DashboardHeader() {
  const { user: authUser, profile, isUserLoading, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const { prices, fiatRates } = usePrices();
  const { language, setLanguage } = useI18n();
  const selectedLanguage = LANGUAGES.flatMap((l) => l.dialects || l).find((l) => l.code === language) || LANGUAGES[0];
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifTab, setNotifTab] = useState<'activity' | 'trades'>('activity');
  const [showAllNotifications, setShowAllNotifications] = useState(false);
  const [allTrades, setAllTrades] = useState<Trade[]>([]);

  const { notifications, unreadCount, markAsRead: handleMarkAsRead, markAllAsRead } = useNotifications();
  const visibleNotifications = showAllNotifications ? notifications : notifications?.slice(0, 5);

  useEffect(() => {
    if (!authUser?.uid) {
      setAllTrades([]);
      return;
    }

    const fetchUserTrades = async () => {
      try {
        const { data, error } = await supabase
          .from('trades')
          .select('*')
          .or(`buyer_id.eq.${authUser.uid},seller_id.eq.${authUser.uid}`)
          .order('created_at', { ascending: false })
          .limit(10);

        if (error) {
          if (error.code !== '42P17') {
            console.warn('Trades fetch notice:', error.message || error);
          }
          return;
        }

        if (data && data.length > 0) {
          const userIds = Array.from(new Set(data.flatMap((t: any) => [t.buyer_id, t.seller_id]).filter(Boolean)));
          let profilesMap: Record<string, any> = {};
          if (userIds.length > 0) {
            const { data: profs } = await supabase
              .from('profiles')
              .select('id, username, avatar_url, photo_url')
              .in('id', userIds);
            if (profs) {
              profs.forEach((p: any) => {
                profilesMap[p.id] = p;
              });
            }
          }

          const mapped: Trade[] = data.map((t: any) => {
            const buyerProfile = profilesMap[t.buyer_id];
            const sellerProfile = profilesMap[t.seller_id];
            return {
              ...t,
              id: t.id,
              tradeId: t.trade_id || t.id,
              buyerId: t.buyer_id,
              sellerId: t.seller_id,
              adId: t.ad_id,
              fiatAmount: Number(t.fiat_amount || 0),
              fiatCurrency: t.fiat_currency || 'USD',
              crypto: (t.crypto || t.cryptocurrency || t.coin_symbol || t.coin || t.asset || 'BTC').toUpperCase(),
              amount: Number(t.amount || 0),
              price: Number(t.price || 0),
              status: t.status || 'created',
              escrow_status: t.escrow_status,
              is_disputed: t.is_disputed,
              payment_window_minutes: t.payment_window_minutes,
              expires_at: t.expires_at,
              paid_at: t.paid_at,
              completed_at: t.completed_at,
              released_at: t.released_at,
              cancelled_at: t.cancelled_at,
              expired_at: t.expired_at,
              createdAt: t.created_at || new Date().toISOString(),
              paymentMethod: t.payment_method || 'Bank Transfer',
              buyer: {
                id: t.buyer_id,
                username: buyerProfile?.username || t.buyer_username || 'Buyer',
                avatar_url: buyerProfile?.avatar_url || buyerProfile?.photo_url || (t.buyer_id ? `/api/media/avatar/${t.buyer_id}` : null),
                photo_url: buyerProfile?.avatar_url || buyerProfile?.photo_url || (t.buyer_id ? `/api/media/avatar/${t.buyer_id}` : null),
                feedbackScore: 100,
                completedTrades: 0,
              } as any,
              seller: {
                id: t.seller_id,
                username: sellerProfile?.username || t.seller_username || 'Seller',
                avatar_url: sellerProfile?.avatar_url || sellerProfile?.photo_url || (t.seller_id ? `/api/media/avatar/${t.seller_id}` : null),
                photo_url: sellerProfile?.avatar_url || sellerProfile?.photo_url || (t.seller_id ? `/api/media/avatar/${t.seller_id}` : null),
                feedbackScore: 100,
                completedTrades: 0,
              } as any,
            };
          });
          setAllTrades(mapped);
        } else {
          setAllTrades([]);
        }
      } catch (err: any) {
        if (err?.code !== '42P17') {
          console.warn('Notice fetching user trades for header:', err?.message || err);
        }
      }
    };

    fetchUserTrades();
  }, [authUser?.uid]);

  const { totalAvailableUsdValue, totalConvertedValue, preferredCurrency: walletPreferredCurrency } = useWallet();

  const preferredCurrency = profile?.preferredCurrency || walletPreferredCurrency || 'USD';
  const totalWalletValueConverted = totalConvertedValue;

  const handleLogout = async () => {
    try {
      await signOut();
      toast({ title: 'Logged Out', description: 'You have been successfully logged out.' });
      router.push('/login');
    } catch (error) {
      toast({ variant: 'destructive', title: 'Logout Failed', description: 'An error occurred during logout.' });
    }
  };

  const handleLanguageSelect = (language: Language) => {
    setLanguage(language.code);
  };

  // Loading State
  if (isUserLoading) {
    return (
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-background px-4 sm:px-6 lg:px-8">
        <Link href="/dashboard">
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
        </div>
      </header>
    );
  }

  // Unauthenticated State
  if (!authUser) {
    return (
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background shadow-xs">
        <div className="flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/">
            <Logo />
          </Link>
          <Button asChild>
            <Link href="/login">Log In</Link>
          </Button>
        </div>
      </header>
    );
  }

  // Authenticated State
  return (
    <header className="sticky top-0 z-30 w-full border-b border-border bg-background shadow-xs">
      <div className="flex h-16 items-center justify-between px-3 sm:px-6 lg:px-8 gap-2">
        {/* Mobile Header Left Toggle & Logo */}
        <div className="flex items-center gap-2 sm:gap-3 lg:hidden shrink-0">
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg shrink-0 hover:bg-slate-100 dark:hover:bg-slate-800">
                <Menu className="h-5 w-5 text-foreground" />
                <span className="sr-only">Toggle navigation menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex flex-col p-0 w-[310px] sm:w-[350px] bg-background">
              <div className="p-5 border-b border-border">
                <div className="flex items-center justify-between">
                  <Link href="/dashboard" onClick={() => setMobileMenuOpen(false)} className="flex items-center">
                    <Logo />
                  </Link>
                </div>
                {/* User Quick Balance Summary in Drawer */}
                <div className="mt-4 p-3 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Estimated Available Balance</span>
                  <div className="text-xl font-extrabold text-foreground mt-0.5 tracking-tight">
                    {totalWalletValueConverted.toLocaleString('en-US', {
                      style: 'currency',
                      currency: preferredCurrency,
                      minimumFractionDigits: 2,
                    })}
                  </div>
                </div>
              </div>

              <ScrollArea className="flex-1 px-3 py-3">
                <div className="space-y-1">
                  {navItems.map((item) => {
                    const isActive =
                      (pathname.startsWith(item.href) && item.href !== '/dashboard') ||
                      pathname === item.href ||
                      (item.href === '/support' && pathname.startsWith('/contact'));
                    const IconComponent = item.icon;

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileMenuOpen(false)}
                        className={cn(
                          'group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold tracking-tight transition-all duration-150',
                          isActive
                            ? 'bg-[#9273FC] text-white shadow-md shadow-indigo-500/20'
                            : 'text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/80 font-medium'
                        )}
                      >
                        <div
                          className={cn(
                            'w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors',
                            isActive
                              ? 'bg-white/20 text-white'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 group-hover:bg-[#9273FC]/10 group-hover:text-[#9273FC]'
                          )}
                        >
                          <IconComponent className="h-5 w-5 shrink-0" />
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col">
                          <span className={cn('text-sm font-bold tracking-tight leading-tight', isActive ? 'text-white' : 'text-slate-900 dark:text-slate-100')}>
                            {item.label}
                          </span>
                          <span className={cn('text-[11px] leading-tight mt-0.5', isActive ? 'text-indigo-100' : 'text-muted-foreground')}>
                            {item.shortDesc}
                          </span>
                        </div>
                        {item.badge && (
                          <span
                            className={cn(
                              'text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider shrink-0',
                              isActive ? 'bg-white/25 text-white' : 'bg-[#9273FC]/10 text-[#9273FC] dark:bg-indigo-500/20 dark:text-indigo-300'
                            )}
                          >
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </ScrollArea>

              <div className="p-4 border-t border-border bg-slate-50/50 dark:bg-slate-900/50 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground font-semibold">Theme Mode</span>
                  <ModeToggle />
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="w-full justify-between h-9 text-xs font-semibold">
                      <div className="flex items-center gap-2">
                        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{selectedLanguage.nativeName}</span>
                      </div>
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-56" align="start">
                    {LANGUAGES.map((lang) =>
                      lang.dialects ? (
                        <DropdownMenuSub key={lang.code}>
                          <DropdownMenuSubTrigger>
                            <span className="font-medium text-xs">{lang.nativeName}</span>
                          </DropdownMenuSubTrigger>
                          <DropdownMenuPortal>
                            <DropdownMenuSubContent>
                              {lang.dialects.map((dialect) => (
                                <DropdownMenuItem key={dialect.code} onClick={() => handleLanguageSelect(dialect)}>
                                  <span className="font-medium text-xs">{dialect.nativeName}</span>
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuSubContent>
                          </DropdownMenuPortal>
                        </DropdownMenuSub>
                      ) : (
                        <DropdownMenuItem key={lang.code} onClick={() => handleLanguageSelect(lang)}>
                          <span className="font-medium text-xs">{lang.nativeName}</span>
                        </DropdownMenuItem>
                      )
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </SheetContent>
          </Sheet>
          <Link href="/dashboard" className="flex items-center shrink-0">
            <Logo />
          </Link>
        </div>

        {/* Desktop Header Left & Modern Navigation */}
        <div className="hidden lg:flex items-center gap-3 xl:gap-5 min-w-0">
          <Link href="/dashboard" className="shrink-0 flex items-center pr-1">
            <Logo />
          </Link>

          {/* Clean Modern Nav Items with High Quality Typography & SVG Icons */}
          <nav className="flex items-center gap-1 xl:gap-1.5 overflow-x-auto scrollbar-none py-1">
            {navItems.map((item) => {
              const isActive =
                (pathname.startsWith(item.href) && item.href !== '/dashboard') ||
                pathname === item.href ||
                (item.href === '/support' && pathname.startsWith('/contact'));
              const IconComponent = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'group flex items-center gap-1.5 px-2.5 xl:px-3 py-1.5 rounded-xl text-xs xl:text-[13px] font-semibold tracking-tight transition-all duration-150 whitespace-nowrap select-none',
                    isActive
                      ? 'bg-gradient-to-r from-[#9273FC] to-[#4F46E5] text-white shadow-sm shadow-indigo-500/25'
                      : 'text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/80 font-medium'
                  )}
                >
                  <IconComponent
                    className={cn(
                      'h-4 w-4 shrink-0 transition-transform duration-150 group-hover:scale-110',
                      isActive ? 'text-white' : 'text-slate-500 dark:text-slate-400 group-hover:text-[#9273FC]'
                    )}
                  />
                  <span className="leading-none">{item.label}</span>
                  {item.badge && (
                    <span
                      className={cn(
                        'text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider leading-none',
                        isActive ? 'bg-white/25 text-white' : 'bg-[#9273FC]/10 text-[#9273FC] dark:bg-indigo-500/20 dark:text-indigo-300'
                      )}
                    >
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right side controls: Theme, Language (EN), Notifications, User Profile & Balance */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {/* Toggle theme */}
          <div className="shrink-0">
            <ModeToggle />
          </div>

          {/* Language Selector ("EN") */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="hidden sm:inline-flex items-center gap-1.5 h-9 px-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-800/60 hover:bg-slate-200/80 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-200 font-bold text-xs tracking-wider transition-all shadow-xs cursor-pointer shrink-0"
                title="Change language"
              >
                <Globe className="h-3.5 w-3.5 text-[#9273FC] shrink-0 stroke-[2.2]" />
                <span className="uppercase font-bold tracking-wider">{selectedLanguage.code}</span>
                <ChevronDown className="h-3 w-3 text-muted-foreground/70 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5 shadow-xl border border-border">
              {LANGUAGES.map((lang) =>
                lang.dialects ? (
                  <DropdownMenuSub key={lang.code}>
                    <DropdownMenuSubTrigger className="rounded-lg py-2 cursor-pointer">
                      <div className="flex flex-col items-start">
                        <span className="font-semibold text-xs">{lang.nativeName}</span>
                        <span className="text-[11px] text-muted-foreground">{lang.name}</span>
                      </div>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                      <DropdownMenuSubContent className="rounded-xl p-1 shadow-lg">
                        {lang.dialects.map((dialect) => (
                          <DropdownMenuItem key={dialect.code} onClick={() => handleLanguageSelect(dialect)} className="rounded-lg py-2 cursor-pointer">
                            <div className="flex flex-col">
                              <span className="font-semibold text-xs">{dialect.nativeName}</span>
                              <span className="text-[11px] text-muted-foreground">{dialect.name}</span>
                            </div>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                  </DropdownMenuSub>
                ) : (
                  <DropdownMenuItem key={lang.code} onClick={() => handleLanguageSelect(lang)} className="rounded-lg py-2 cursor-pointer">
                    <div className="flex flex-col">
                      <span className="font-semibold text-xs">{lang.nativeName}</span>
                      <span className="text-[11px] text-muted-foreground">{lang.name}</span>
                    </div>
                  </DropdownMenuItem>
                )
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Toggle notifications */}
          <DropdownMenu onOpenChange={(open) => !open && setShowAllNotifications(false)}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-800/60 hover:bg-slate-200/80 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-200 transition-all shadow-xs relative flex items-center justify-center cursor-pointer"
                title="Toggle notifications"
              >
                <Bell className="h-4 w-4 text-slate-700 dark:text-slate-300 stroke-[2]" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-4 px-1 items-center justify-center text-[10px] font-extrabold text-white bg-rose-600 rounded-full shadow-xs ring-2 ring-background animate-in fade-in">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
                <span className="sr-only">Toggle notifications</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[390px] sm:w-[420px] p-0 rounded-2xl shadow-2xl border border-border overflow-hidden">
              {/* Dropdown Header & Segmented Tabs */}
              <div className="p-3 bg-muted/30 border-b border-border/60">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-sm text-foreground">Notifications & Activity</span>
                  <div className="flex items-center gap-2">
                    {unreadCount > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[11px] px-2 text-primary font-medium hover:text-primary/80 flex items-center gap-1"
                        onClick={() => markAllAsRead && markAllAsRead()}
                      >
                        <CheckCheck className="h-3 w-3" /> Mark all read
                      </Button>
                    )}
                    <Button asChild variant="link" className="text-xs h-auto p-0 text-muted-foreground hover:text-foreground">
                      <Link href="/notifications">View All</Link>
                    </Button>
                  </div>
                </div>

                {/* Segmented Switcher */}
                <div className="grid grid-cols-2 gap-1 p-1 bg-muted/60 dark:bg-slate-900/60 rounded-xl border border-border/40">
                  <button
                    type="button"
                    onClick={() => setNotifTab('activity')}
                    className={cn(
                      'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-bold transition-all',
                      notifTab === 'activity'
                        ? 'bg-background text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <span>Activity Center</span>
                    {unreadCount > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white text-[10px] font-mono leading-tight">
                        {unreadCount}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setNotifTab('trades')}
                    className={cn(
                      'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-bold transition-all',
                      notifTab === 'trades'
                        ? 'bg-background text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <span>Recent Trades</span>
                    {allTrades.length > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full bg-muted-foreground/20 text-foreground text-[10px] font-mono leading-tight">
                        {allTrades.length}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* Tab 1: Activity Center */}
              {notifTab === 'activity' && (
                <ScrollArea className="max-h-[420px] p-2">
                  <div className="space-y-1">
                    {notifications && notifications.length > 0 ? (
                      <>
                        {visibleNotifications?.map((n) => {
                          const icon = getActivityIcon(n.message);
                          return (
                            <DropdownMenuItem
                              key={n.id}
                              asChild
                              className={cn(
                                'flex items-start gap-3 p-2.5 rounded-xl cursor-pointer transition-colors whitespace-normal mb-1',
                                !n.isRead ? 'bg-primary/5 dark:bg-primary/10 border border-primary/20' : 'hover:bg-muted/50 border border-transparent'
                              )}
                            >
                              <Link href={n.link || '#'} onClick={() => handleMarkAsRead(n.id)}>
                                <div className="mt-0.5 p-1.5 rounded-lg bg-muted/80 shrink-0 border border-border/50">
                                  {icon}
                                </div>
                                <div className="flex flex-col min-w-0 flex-grow">
                                  <div className="flex items-start justify-between gap-1">
                                    <p className="text-xs font-semibold text-foreground leading-snug">
                                      {n.message}
                                    </p>
                                    {!n.isRead && (
                                      <span className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1" />
                                    )}
                                  </div>
                                  <p className="text-[10px] font-medium text-muted-foreground mt-1 font-[Arial,Helvetica,sans-serif] tabular-nums">
                                    {formatDateArial(n.createdAt)}
                                  </p>
                                </div>
                              </Link>
                            </DropdownMenuItem>
                          );
                        })}
                        {!showAllNotifications && notifications.length > 5 && (
                          <Button
                            variant="ghost"
                            className="w-full justify-center text-xs h-8 text-muted-foreground hover:text-foreground mt-1"
                            onClick={() => setShowAllNotifications(true)}
                          >
                            <ChevronDown className="h-3.5 w-3.5 mr-1" /> Show All Activities
                          </Button>
                        )}
                      </>
                    ) : (
                      <div className="py-8 text-center">
                        <Bell className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                        <p className="text-xs text-muted-foreground font-medium">No recent activity.</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              )}

              {/* Tab 2: Recent Trades */}
              {notifTab === 'trades' && (
                <ScrollArea className="max-h-[420px] p-2">
                  <div className="space-y-1">
                    {allTrades.length > 0 ? (
                      allTrades.map((trade) => (
                        <RecentTradeNotificationRow
                          key={trade.id}
                          trade={trade}
                          currentUserId={authUser?.uid}
                        />
                      ))
                    ) : (
                      <div className="py-8 text-center">
                        <ArrowLeftRight className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                        <p className="text-xs text-muted-foreground font-medium">No recent trades found.</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-10 px-1.5 sm:px-2.5 py-1 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 text-foreground transition-all shadow-xs flex items-center gap-1.5 sm:gap-2 cursor-pointer select-none group shrink-0"
              >
                <div className="relative shrink-0 flex items-center">
                  <Avatar className="h-7 w-7 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                    {(authUser?.photoURL || (profile as any)?.avatar_url || (profile as any)?.photo_url) ? (
                      <AvatarImage src={authUser?.photoURL || (profile as any)?.avatar_url || (profile as any)?.photo_url} alt={authUser?.displayName || profile?.username || 'User Avatar'} />
                    ) : (
                      <AvatarFallback className="bg-[#18181b] p-0.5">
                        <img src="/default-avatar.svg" alt="Avatar" className="w-full h-full object-cover" />
                      </AvatarFallback>
                    )}
                  </Avatar>
                  <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-1.5 ring-white dark:ring-slate-900" />
                </div>

                {profile?.country && (
                  <FlagIcon countryCode={profile.country} className="hidden xs:block w-4 h-3 rounded-[2px] object-cover shadow-xs shrink-0" />
                )}

                <div className="flex flex-col text-left min-w-0 justify-center">
                  {authUser?.displayName || profile?.username ? (
                    <span className="font-bold text-xs sm:text-[13px] text-slate-900 dark:text-white tracking-tight truncate max-w-[70px] xs:max-w-[95px] sm:max-w-[120px] leading-tight">
                      {authUser.displayName || profile?.username}
                    </span>
                  ) : (
                    <Skeleton className="h-3.5 w-14 sm:w-16 mb-0.5" />
                  )}
                  <div className="flex items-center gap-1 text-[10px] sm:text-[11px] font-bold text-emerald-600 dark:text-emerald-400 font-mono leading-none mt-0.5">
                    <Wallet className="h-2.5 w-2.5 text-emerald-500 shrink-0 stroke-[2.2]" />
                    <span className="truncate max-w-[65px] xs:max-w-[85px] sm:max-w-none">
                      {totalWalletValueConverted.toLocaleString(undefined, {
                        style: 'currency',
                        currency: preferredCurrency,
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                </div>

                <ChevronDown className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-muted-foreground/70 shrink-0 group-hover:text-foreground transition-colors ml-0.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5 shadow-xl border border-border">
              <div className="px-3 py-2 border-b border-border/60 mb-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-foreground truncate">
                    {authUser?.displayName || profile?.username || 'My Account'}
                  </p>
                  {profile?.country && <FlagIcon countryCode={profile.country} className="w-4 h-3 rounded-[2px]" />}
                </div>
                <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                  <Wallet className="w-3 h-3 text-emerald-500 shrink-0 stroke-[2]" />
                  <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-xs">
                    {totalWalletValueConverted.toLocaleString(undefined, {
                      style: 'currency',
                      currency: preferredCurrency,
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              </div>
              <DropdownMenuItem asChild className="rounded-lg py-2 cursor-pointer">
                <Link href="/dashboard" className="flex items-center gap-2.5 text-xs font-medium">
                  <HdDashboardIcon className="h-4 w-4 text-[#9273FC]" />
                  <span>Dashboard</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="rounded-lg py-2 cursor-pointer">
                <Link href="/profile" className="flex items-center gap-2.5 text-xs font-medium">
                  <HdProfileIcon className="h-4 w-4 text-[#9273FC]" />
                  <span>Profile</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="rounded-lg py-2 cursor-pointer">
                <Link href="/wallets" className="flex items-center gap-2.5 text-xs font-medium">
                  <HdWalletsIcon className="h-4 w-4 text-[#9273FC]" />
                  <span>Wallets</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="rounded-lg py-2 cursor-pointer">
                <Link href="/my-ads" className="flex items-center gap-2.5 text-xs font-medium">
                  <HdMyAdsIcon className="h-4 w-4 text-[#9273FC]" />
                  <span>My Ads</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="rounded-lg py-2 cursor-pointer">
                <Link href="/trades" className="flex items-center gap-2.5 text-xs font-medium">
                  <HdMyTradesIcon className="h-4 w-4 text-[#9273FC]" />
                  <span>My Trades</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="rounded-lg py-2 cursor-pointer">
                <Link href="/my-tickets" className="flex items-center gap-2.5 text-xs font-medium">
                  <HdTicketsIcon className="h-4 w-4 text-[#9273FC]" />
                  <span>My Tickets</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="rounded-lg py-2 cursor-pointer">
                <Link href="/settings" className="flex items-center gap-2.5 text-xs font-medium">
                  <HdSettingsIcon className="h-4 w-4 text-[#9273FC]" />
                  <span>Settings</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="my-1" />
              <DropdownMenuItem onClick={handleLogout} className="rounded-lg py-2 cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10">
                <LogOut className="mr-2 h-4 w-4 stroke-[2]" />
                <span className="font-semibold text-xs">Logout</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
