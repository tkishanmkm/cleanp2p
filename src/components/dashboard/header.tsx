'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Bell,
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  PlusCircle,
  LifeBuoy,
  Menu,
  ArrowDownToLine,
  ArrowUpFromLine,
  Mail,
  FileText,
  LogOut,
  User,
  Settings,
  Send,
  Globe,
  ChevronDown,
} from 'lucide-react';
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
import type { Language, Trade, CryptoCurrency } from '@/lib/types';
import { Skeleton } from '../ui/skeleton';
import { cn, toDate } from '@/lib/utils';
import { usePrices } from '@/context/price-context';
import { useToast } from '@/hooks/use-toast';
import { LANGUAGES } from '@/lib/constants';
import { FlagIcon } from '../ui/flag-icon';
import { useI18n } from '@/context/i18n-context';
import { ScrollArea } from '../ui/scroll-area';
import { useState, useEffect } from 'react';
import { statusColors } from '@/lib/status-colors';
import { supabase } from '@/lib/supabase/client';

type NavItem = {
  href?: string;
  label: string;
  icon: React.ElementType;
  isDropdown?: boolean;
  items?: { href: string; label: string }[];
};

const navItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/wallets', label: 'Wallets', icon: Wallet },
  { href: '/buy', label: 'Buy Coin', icon: ArrowDownToLine },
  { href: '/sell', label: 'Sell Coin', icon: ArrowUpFromLine },
  { href: '/transfer', label: 'Transfer', icon: Send },
  { href: '/ads/create', label: 'Create Ad', icon: PlusCircle },
  { href: '/my-ads', label: 'My Ads', icon: FileText },
  { href: '/trades', label: 'My Trades', icon: ArrowLeftRight },
  { href: '/support', label: 'Support', icon: LifeBuoy },
];

const CryptoLogo = ({ crypto, className }: { crypto: CryptoCurrency; className?: string }) => {
  switch (crypto) {
    case 'BTC':
      return <BtcLogo className={className} />;
    case 'ETH':
      return <EthLogo className={className} />;
    case 'LTC':
      return <LtcLogo className={className} />;
    case 'USDT':
      return <UsdtLogo className={className} />;
    default:
      return null;
  }
};

export function DashboardHeader() {
  const { user: authUser, profile, isUserLoading, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const { prices, fiatRates } = usePrices();
  const { language, setLanguage } = useI18n();
  const selectedLanguage = LANGUAGES.flatMap((l) => l.dialects || l).find((l) => l.code === language) || LANGUAGES[0];
  const [showAllNotifications, setShowAllNotifications] = useState(false);
  const [allTrades, setAllTrades] = useState<Trade[]>([]);

  const { notifications, unreadCount, markAsRead: handleMarkAsRead } = useNotifications();
  const visibleNotifications = showAllNotifications ? notifications : notifications?.slice(0, 3);

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

        if (error) throw error;

        const mapped: Trade[] = (data || []).map((t: any) => ({
          id: t.id,
          tradeId: t.trade_id || t.id,
          buyerId: t.buyer_id,
          sellerId: t.seller_id,
          adId: t.ad_id,
          fiatAmount: Number(t.fiat_amount || 0),
          fiatCurrency: t.fiat_currency || 'USD',
          crypto: t.crypto || 'USDT',
          amount: Number(t.amount || 0),
          price: Number(t.price || 0),
          status: t.status || 'created',
          createdAt: t.created_at || new Date().toISOString(),
          paymentMethod: t.payment_method || 'Bank Transfer',
          buyer: {
            id: t.buyer_id,
            username: t.buyer_username || 'Buyer',
            feedbackScore: 100,
            completedTrades: 0,
          },
          seller: {
            id: t.seller_id,
            username: t.seller_username || 'Seller',
            feedbackScore: 100,
            completedTrades: 0,
          },
        }));

        setAllTrades(mapped);
      } catch (err) {
        console.error('Error fetching user trades for header:', err);
      }
    };

    fetchUserTrades();
  }, [authUser?.uid]);

  const btcVal = (profile?.btcBalance || 0) * (prices['BTC'] || 0);
  const ethVal = (profile?.ethBalance || 0) * (prices['ETH'] || 0);
  const ltcVal = (profile?.ltcBalance || 0) * (prices['LTC'] || 0);
  const usdtVal = (profile?.usdtBalance || 0) * (prices['USDT'] || 1);
  const totalWalletValueUSD = btcVal + ethVal + ltcVal + usdtVal;

  const preferredCurrency = profile?.preferredCurrency || 'USD';
  const exchangeRate = fiatRates[preferredCurrency] || 1;
  const totalWalletValueConverted = totalWalletValueUSD * exchangeRate;

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
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
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
    <header className="sticky top-0 z-30 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-16 items-center px-4 sm:px-6 lg:px-8">
        {/* Mobile Header Left Toggle & Logo */}
        <div className="flex items-center gap-2 lg:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg shrink-0 hover:bg-slate-100 dark:hover:bg-slate-800">
                <Menu className="h-5 w-5 text-foreground" />
                <span className="sr-only">Toggle navigation menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex flex-col p-0 w-[300px] sm:w-[340px] bg-background">
              <div className="p-5 border-b border-border/60">
                <Link href="/dashboard" className="flex items-center">
                  <Logo />
                </Link>
                {/* User Quick Balance Summary in Drawer */}
                <div className="mt-4 p-3 rounded-xl bg-gradient-to-r from-[#5B4DF6]/10 to-[#3B82F6]/10 border border-[#5B4DF6]/20">
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Estimated Total Balance</span>
                  <div className="text-lg font-bold text-foreground mt-0.5">
                    {totalWalletValueConverted.toLocaleString('en-US', {
                      style: 'currency',
                      currency: preferredCurrency,
                      minimumFractionDigits: 2,
                    })}
                  </div>
                </div>
              </div>

              <ScrollArea className="flex-1 px-4 py-3">
                <div className="space-y-1">
                  {navItems.map((item) => {
                    const isActive =
                      (pathname.startsWith(item.href!) && item.href !== '/dashboard') ||
                      pathname === item.href ||
                      (item.href === '/support' && pathname.startsWith('/contact'));
                    const IconComponent = item.icon;

                    return (
                      <Link
                        key={item.href}
                        href={item.href!}
                        className={cn(
                          'flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold tracking-tight transition-all duration-150',
                          isActive
                            ? 'bg-gradient-to-r from-[#5B4DF6] to-[#4F46E5] text-white shadow-sm shadow-indigo-500/25 font-bold'
                            : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100/90 dark:hover:bg-slate-800/80 font-medium'
                        )}
                      >
                        <IconComponent className={cn('h-4 w-4 shrink-0', isActive ? 'text-white stroke-[2.2]' : 'text-slate-500 dark:text-slate-400 stroke-[2]')} />
                        <span className="flex-1">{item.label}</span>
                        {item.href === '/ads/create' && (
                          <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider', isActive ? 'bg-white/20 text-white' : 'bg-[#5B4DF6]/10 text-[#5B4DF6] dark:bg-indigo-500/20 dark:text-indigo-300')}>
                            Post
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </ScrollArea>

              <div className="p-4 border-t border-border/60 bg-muted/20 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground font-medium">Theme Mode</span>
                  <ModeToggle />
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="w-full justify-between h-9 text-xs">
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
          <Link href="/dashboard" className="flex items-center">
            <Logo />
          </Link>
        </div>

        {/* Desktop Header Left & Modern Navigation */}
        <div className="hidden lg:flex items-center gap-4 xl:gap-6 min-w-0">
          <Link href="/dashboard" className="shrink-0 flex items-center">
            <Logo />
          </Link>

          {/* Clean Modern Nav Items with High Quality Typography & SVG Icons */}
          <nav className="flex items-center gap-1 xl:gap-1.5 overflow-x-auto scrollbar-none py-1">
            {navItems.map((item) => {
              const isActive =
                (pathname.startsWith(item.href!) && item.href !== '/dashboard') ||
                pathname === item.href ||
                (item.href === '/support' && pathname.startsWith('/contact'));
              const IconComponent = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href!}
                  className={cn(
                    'group flex items-center gap-1.5 px-2.5 xl:px-3 py-1.5 rounded-xl text-xs xl:text-[13px] font-semibold tracking-tight transition-all duration-150 whitespace-nowrap select-none',
                    isActive
                      ? 'bg-gradient-to-r from-[#5B4DF6] to-[#4F46E5] text-white shadow-sm shadow-indigo-500/25'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100/90 dark:hover:bg-slate-800/80 font-medium'
                  )}
                >
                  <IconComponent
                    className={cn(
                      'h-4 w-4 shrink-0 transition-transform duration-150 group-hover:scale-105',
                      isActive ? 'text-white stroke-[2.2]' : 'text-slate-500 dark:text-slate-400 group-hover:text-[#5B4DF6] stroke-[2]'
                    )}
                  />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right side controls: Theme, Language (EN), Notifications, User Profile & Balance */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Toggle theme */}
          <ModeToggle />

          {/* Language Selector ("EN") */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="hidden sm:inline-flex items-center gap-1.5 h-9 px-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-800/60 hover:bg-slate-200/80 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-200 font-bold text-xs tracking-wider transition-all shadow-xs cursor-pointer"
                title="Change language"
              >
                <Globe className="h-3.5 w-3.5 text-[#5B4DF6] shrink-0 stroke-[2.2]" />
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
            <DropdownMenuContent align="end" className="w-[380px] p-0">
              <div className="flex items-center justify-between p-2">
                <DropdownMenuLabel className="p-0">Activity Center</DropdownMenuLabel>
                <Button asChild variant="link" className="text-xs h-auto p-0">
                  <Link href="/notifications">View All</Link>
                </Button>
              </div>
              <DropdownMenuSeparator />
              <ScrollArea className="h-[450px]">
                <div className="p-1 space-y-1">
                  {notifications && notifications.length > 0 ? (
                    <>
                      {visibleNotifications?.map((n) => (
                        <DropdownMenuItem
                          key={n.id}
                          asChild
                          className={cn('flex items-start gap-2 whitespace-normal', !n.isRead && 'bg-secondary')}
                        >
                          <Link href={n.link || '#'} onClick={() => handleMarkAsRead(n.id)}>
                            <Mail className="mt-1 h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <div className="flex flex-col">
                              <p className="text-sm leading-snug">{n.message}</p>
                              <p className="text-xs text-muted-foreground mt-1">
                                {toDate(n.createdAt)?.toLocaleString('default', {
                                  dateStyle: 'short',
                                  timeStyle: 'short',
                                }) ?? 'Invalid Date'}
                              </p>
                            </div>
                          </Link>
                        </DropdownMenuItem>
                      ))}
                      {!showAllNotifications && notifications.length > 3 && (
                        <Button
                          variant="ghost"
                          className="w-full justify-center text-xs"
                          onClick={() => setShowAllNotifications(true)}
                        >
                          <ChevronDown className="h-4 w-4 mr-1" /> Show All
                        </Button>
                      )}
                    </>
                  ) : (
                    <p className="p-4 text-center text-sm text-muted-foreground">No new notifications.</p>
                  )}
                </div>
                <DropdownMenuSeparator />
                <div className="p-2">
                  <DropdownMenuLabel className="p-0 text-xs font-semibold">Recent Trades</DropdownMenuLabel>
                </div>
                <div className="p-1 space-y-1">
                  {allTrades.length > 0 ? (
                    allTrades.slice(0, 5).map((trade) => {
                      const isBuyer = trade.buyerId === authUser?.uid;
                      const partner = isBuyer ? trade.seller : trade.buyer;
                      return (
                        <DropdownMenuItem key={trade.id} asChild className="p-0">
                          <Link href={`/trade/${trade.id}`} className="flex items-center gap-3 p-2">
                            <Avatar className="h-9 w-9">
                              <AvatarFallback>{partner.username.substring(0, 2).toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <div className="flex-grow overflow-hidden">
                              <p className="text-sm font-medium truncate">{partner.username}</p>
                              <div className="flex items-center gap-2">
                                <Badge
                                  className={cn(
                                    'text-xs h-auto',
                                    isBuyer
                                      ? 'bg-green-600 text-primary-foreground hover:bg-green-600/90'
                                      : 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                                  )}
                                >
                                  {isBuyer ? 'Buy' : 'Sell'}
                                </Badge>
                                <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                                  {trade.amount.toFixed(4)} {trade.crypto}
                                  <CryptoLogo crypto={trade.crypto as CryptoCurrency} className="h-4 w-4" />
                                </p>
                              </div>
                            </div>
                            <div className="text-right text-xs shrink-0">
                              <p className="font-semibold">
                                {trade.fiatAmount.toLocaleString()} {trade.fiatCurrency}
                              </p>
                              <Badge variant="outline" className={cn('capitalize mt-1', statusColors[trade.status])}>
                                {trade.status}
                              </Badge>
                            </div>
                          </Link>
                        </DropdownMenuItem>
                      );
                    })
                  ) : (
                    <p className="p-4 text-center text-sm text-muted-foreground">No recent trades.</p>
                  )}
                </div>
              </ScrollArea>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-10 pl-2 pr-2.5 py-1 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 text-foreground transition-all shadow-xs flex items-center gap-2 cursor-pointer select-none group"
              >
                <div className="relative shrink-0 flex items-center">
                  <Avatar className="h-7 w-7 rounded-lg border border-slate-200 dark:border-slate-700">
                    {profile?.photoURL ? (
                      <AvatarImage src={profile.photoURL} alt={authUser.displayName || profile?.username || 'User Avatar'} />
                    ) : (
                      <AvatarFallback className="bg-gradient-to-br from-[#5B4DF6] to-[#3B82F6] text-white text-[11px] font-bold">
                        {(authUser.displayName || profile?.username || 'User').substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    )}
                  </Avatar>
                  <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-1.5 ring-white dark:ring-slate-900" />
                </div>

                {profile?.country && (
                  <FlagIcon countryCode={profile.country} className="w-4 h-3 rounded-[2px] object-cover shadow-xs shrink-0" />
                )}

                <div className="flex flex-col text-left min-w-0 justify-center">
                  {authUser?.displayName || profile?.username ? (
                    <span className="font-bold text-xs sm:text-[13px] text-slate-900 dark:text-white tracking-tight truncate max-w-[90px] sm:max-w-[120px] leading-tight">
                      {authUser.displayName || profile?.username}
                    </span>
                  ) : (
                    <Skeleton className="h-3.5 w-16 mb-0.5" />
                  )}
                  <div className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 font-mono leading-none mt-0.5">
                    <Wallet className="h-2.5 w-2.5 text-emerald-500 shrink-0 stroke-[2.2]" />
                    <span className="truncate">
                      {totalWalletValueConverted.toLocaleString(undefined, {
                        style: 'currency',
                        currency: preferredCurrency,
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                </div>

                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0 group-hover:text-foreground transition-colors ml-0.5" />
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
                  <LayoutDashboard className="h-4 w-4 text-[#5B4DF6] stroke-[2]" />
                  <span>Dashboard</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="rounded-lg py-2 cursor-pointer">
                <Link href="/profile" className="flex items-center gap-2.5 text-xs font-medium">
                  <User className="h-4 w-4 text-blue-500 stroke-[2]" />
                  <span>Profile</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="rounded-lg py-2 cursor-pointer">
                <Link href="/wallets" className="flex items-center gap-2.5 text-xs font-medium">
                  <Wallet className="h-4 w-4 text-emerald-500 stroke-[2]" />
                  <span>Wallets</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="rounded-lg py-2 cursor-pointer">
                <Link href="/my-ads" className="flex items-center gap-2.5 text-xs font-medium">
                  <FileText className="h-4 w-4 text-amber-500 stroke-[2]" />
                  <span>My Ads</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="rounded-lg py-2 cursor-pointer">
                <Link href="/trades" className="flex items-center gap-2.5 text-xs font-medium">
                  <ArrowLeftRight className="h-4 w-4 text-purple-500 stroke-[2]" />
                  <span>My Trades</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="rounded-lg py-2 cursor-pointer">
                <Link href="/my-tickets" className="flex items-center gap-2.5 text-xs font-medium">
                  <LifeBuoy className="h-4 w-4 text-sky-500 stroke-[2]" />
                  <span>My Tickets</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="rounded-lg py-2 cursor-pointer">
                <Link href="/settings" className="flex items-center gap-2.5 text-xs font-medium">
                  <Settings className="h-4 w-4 text-slate-500 stroke-[2]" />
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
