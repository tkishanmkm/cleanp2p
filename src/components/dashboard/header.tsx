
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
import { useFirebase, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { Logo } from '@/components/logo';
import { ModeToggle } from '@/components/mode-toggle';
import { BtcLogo, EthLogo, LtcLogo, UsdtLogo, DefaultAvatar } from '../icons';
import { Badge } from '../ui/badge';
import { collection, doc, orderBy, query, updateDoc, where } from 'firebase/firestore';
import type { UserWallet, Notification, User as AppUser, Language, Trade, CryptoCurrency } from '@/lib/types';
import { Skeleton } from '../ui/skeleton';
import { cn, toDate } from '@/lib/utils';
import { usePrices } from '@/context/price-context';
import { signOut } from 'firebase/auth';
import { useToast } from '@/hooks/use-toast';
import { LANGUAGES } from '@/lib/constants';
import { FlagIcon } from '../ui/flag-icon';
import { useI18n } from '@/context/i18n-context';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { ScrollArea } from '../ui/scroll-area';
import { useState, useEffect } from 'react';
import { statusColors } from '@/lib/status-colors';


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
  { href: '/contact', label: 'Support', icon: LifeBuoy },
];

const CryptoLogo = ({ crypto, className }: { crypto: CryptoCurrency; className?: string }) => {
    switch (crypto) {
        case 'BTC': return <BtcLogo className={className} />;
        case 'ETH': return <EthLogo className={className} />;
        case 'LTC': return <LtcLogo className={className} />;
        case 'USDT': return <UsdtLogo className={className} />;
        default: return null;
    }
}

export function DashboardHeader() {
  const { user: authUser, isUserLoading, firestore, auth } = useFirebase();
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const { prices, fiatRates } = usePrices();
  const { language, setLanguage } = useI18n();
  const selectedLanguage = LANGUAGES.flatMap(l => l.dialects || l).find(l => l.code === language) || LANGUAGES[0];
  const [showAllNotifications, setShowAllNotifications] = useState(false);


  const userDocRef = useMemoFirebase(() => (authUser ? doc(firestore, 'users', authUser.uid) : null), [
    firestore,
    authUser,
  ]);
  const { data: userData } = useDoc<AppUser>(userDocRef);

  const walletsRef = useMemoFirebase(
    () => (authUser ? collection(firestore, 'users', authUser.uid, 'wallets') : null),
    [firestore, authUser]
  );
  const { data: wallets } = useCollection<UserWallet>(walletsRef);

  const notificationsRef = useMemoFirebase(
    () => (authUser ? collection(firestore, 'users', authUser.uid, 'notifications') : null),
    [firestore, authUser]
  );
  const notificationsQuery = useMemoFirebase(
    () => (notificationsRef ? query(notificationsRef, orderBy('createdAt', 'desc')) : null),
    [notificationsRef]
  );
  const { data: notifications } = useCollection<Notification>(notificationsQuery);
  const unreadCount = notifications?.filter((n) => !n.isRead).length || 0;
  const visibleNotifications = showAllNotifications ? notifications : notifications?.slice(0, 3);

  const tradesAsBuyerQuery = useMemoFirebase(() => authUser ? query(collection(firestore, 'trades'), where('buyerId', '==', authUser.uid)) : null, [firestore, authUser]);
  const tradesAsSellerQuery = useMemoFirebase(() => authUser ? query(collection(firestore, 'trades'), where('sellerId', '==', authUser.uid)) : null, [firestore, authUser]);

  const { data: buyerTrades } = useCollection<Trade>(tradesAsBuyerQuery);
  const { data: sellerTrades } = useCollection<Trade>(tradesAsSellerQuery);
  const [allTrades, setAllTrades] = useState<Trade[]>([]);

  useEffect(() => {
    if (buyerTrades || sellerTrades) {
      const combined = [...(buyerTrades || []), ...(sellerTrades || [])];
      const uniqueTrades = Array.from(new Map(combined.map(trade => [trade.id, trade])).values());
      uniqueTrades.sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
      setAllTrades(uniqueTrades);
    }
  }, [buyerTrades, sellerTrades]);

  const totalWalletValueUSD =
    wallets?.reduce((acc, wallet) => {
      const value = (wallet.balance || 0) * (prices[wallet.crypto] || 0);
      return acc + value;
    }, 0) || 0;

  const preferredCurrency = userData?.preferredCurrency || 'USD';
  const exchangeRate = fiatRates[preferredCurrency] || 1;
  const totalWalletValueConverted = totalWalletValueUSD * exchangeRate;

  const handleMarkAsRead = async (notificationId: string) => {
    if (!firestore || !authUser) return;
    const notifRef = doc(firestore, 'users', authUser.uid, 'notifications', notificationId);
    await updateDoc(notifRef, { isRead: true });
  };

  const handleLogout = async () => {
    if (!auth) return;
    try {
      await signOut(auth);
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
      router.push('/login');
    } catch (error) {
      toast({ variant: "destructive", title: "Logout Failed", description: "An error occurred during logout." });
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
        
        {/* Mobile Header Left */}
        <div className="flex items-center gap-1 md:hidden">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="shrink-0">
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Toggle navigation menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="flex flex-col p-0">
                <nav className="grid gap-6 text-lg font-medium mt-8 px-6">
                  <Link href="/dashboard" className="flex items-center gap-2 text-lg font-semibold">
                    <Logo />
                  </Link>
                  {navItems.map((item) => (
                    item.isDropdown ? (
                        <div key={item.label} className="grid gap-4">
                          <p className="flex items-center gap-4 text-base text-muted-foreground">
                            <item.icon className="h-5 w-5" />
                            {item.label}
                          </p>
                          <div className="grid gap-4 pl-9">
                            {item.items?.map(subItem => (
                              <Link
                                key={subItem.href}
                                href={subItem.href}
                                className={`flex items-center gap-4 text-base transition-colors ${
                                  pathname.startsWith(subItem.href)
                                    ? 'text-foreground font-semibold'
                                    : 'text-muted-foreground hover:text-foreground'
                                }`}
                              >
                                {subItem.label}
                              </Link>
                            ))}
                          </div>
                        </div>
                      ) : (
                      <Link
                        key={item.href}
                        href={item.href!}
                        className={`flex items-center gap-4 text-base transition-colors ${
                          (pathname.startsWith(item.href!) && item.href !== '/dashboard') || pathname === item.href
                            ? 'text-foreground font-semibold'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <item.icon className="h-5 w-5" />
                        {item.label}
                      </Link>
                    )
                  ))}
                </nav>
                 <div className="mt-auto p-6">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" className="w-full justify-start">
                            <Globe className="mr-2 h-4 w-4" />
                            <span>{selectedLanguage.nativeName}</span>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                            {LANGUAGES.map((lang) =>
                            lang.dialects ? (
                                <DropdownMenuSub key={lang.code}>
                                <DropdownMenuSubTrigger>
                                    <div className="flex flex-col items-start">
                                    <span className="font-medium">{lang.nativeName}</span>
                                    </div>
                                </DropdownMenuSubTrigger>
                                <DropdownMenuPortal>
                                    <DropdownMenuSubContent>
                                    {lang.dialects.map((dialect) => (
                                        <DropdownMenuItem key={dialect.code} onClick={() => handleLanguageSelect(dialect)}>
                                        <div className="flex flex-col">
                                            <span className="font-medium">{dialect.nativeName}</span>
                                        </div>
                                        </DropdownMenuItem>
                                    ))}
                                    </DropdownMenuSubContent>
                                </DropdownMenuPortal>
                                </DropdownMenuSub>
                            ) : (
                                <DropdownMenuItem key={lang.code} onClick={() => handleLanguageSelect(lang)}>
                                <div className="flex flex-col">
                                    <span className="font-medium">{lang.nativeName}</span>
                                </div>
                                </DropdownMenuItem>
                            )
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
              </SheetContent>
            </Sheet>
            <Link href="/dashboard">
                <Logo />
            </Link>
        </div>


        {/* Desktop Header Left */}
        <div className="hidden md:flex items-center gap-6">
            <Link href="/dashboard">
                <Logo />
            </Link>
            <nav className="hidden md:flex items-center gap-1">
              {navItems.map((item) => (
                item.isDropdown ? (
                  <DropdownMenu key={item.label}>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        className={cn(
                          'h-auto px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground flex items-center gap-2',
                          item.items?.some(subItem => pathname.startsWith(subItem.href))
                            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                            : 'text-muted-foreground'
                        )}
                      >
                        <item.icon className="h-4 w-4" />
                        {item.label}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {item.items?.map(subItem => (
                        <DropdownMenuItem key={subItem.href} asChild>
                          <Link href={subItem.href}>{subItem.label}</Link>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Button
                    key={item.href}
                    asChild
                    variant="ghost"
                    className={cn(
                      'h-auto px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground',
                      (pathname.startsWith(item.href!) && item.href !== '/dashboard') || pathname === item.href
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                        : 'text-muted-foreground'
                    )}
                  >
                    <Link href={item.href!} className="flex items-center gap-2">
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  </Button>
                )
              ))}
            </nav>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right side */}
        <div className="flex items-center gap-2">
          <ModeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="hidden sm:inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <Globe className="h-4 w-4" />
                <span>{selectedLanguage.code.toUpperCase()}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {LANGUAGES.map((lang) =>
                lang.dialects ? (
                  <DropdownMenuSub key={lang.code}>
                    <DropdownMenuSubTrigger>
                      <div className="flex flex-col items-start">
                        <span className="font-medium">{lang.nativeName}</span>
                        <span className="text-xs text-muted-foreground">{lang.name}</span>
                      </div>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                      <DropdownMenuSubContent>
                        {lang.dialects.map(dialect => (
                          <DropdownMenuItem key={dialect.code} onClick={() => handleLanguageSelect(dialect)}>
                            <div className="flex flex-col">
                              <span className="font-medium">{dialect.nativeName}</span>
                              <span className="text-xs text-muted-foreground">{dialect.name}</span>
                            </div>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                  </DropdownMenuSub>
                ) : (
                  <DropdownMenuItem key={lang.code} onClick={() => handleLanguageSelect(lang)}>
                    <div className="flex flex-col">
                        <span className="font-medium">{lang.nativeName}</span>
                        <span className="text-xs text-muted-foreground">{lang.name}</span>
                    </div>
                  </DropdownMenuItem>
                )
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu onOpenChange={(open) => !open && setShowAllNotifications(false)}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full relative">
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <Badge variant="destructive" className="absolute -top-1 -right-1 h-5 w-5 justify-center p-0">
                    {unreadCount}
                  </Badge>
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
                                {toDate(n.createdAt)?.toLocaleString('default', { dateStyle: 'short', timeStyle: 'short' }) ?? 'Invalid Date'}
                              </p>
                            </div>
                          </Link>
                        </DropdownMenuItem>
                      ))}
                      {!showAllNotifications && notifications.length > 3 && (
                        <Button variant="ghost" className="w-full justify-center text-xs" onClick={() => setShowAllNotifications(true)}>
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
                        allTrades.slice(0, 5).map(trade => {
                             const isBuyer = trade.buyerId === authUser?.uid;
                             const partner = isBuyer ? trade.seller : trade.buyer;
                             return (
                                <DropdownMenuItem key={trade.id} asChild className="p-0">
                                    <Link href={`/trade/${trade.id}`} className="flex items-center gap-3 p-2">
                                        <Avatar className="h-9 w-9">
                                            {/* Assuming partner has photoURL */}
                                            {/* <AvatarImage src={partner.photoURL} /> */}
                                            <AvatarFallback>{partner.username.substring(0, 2).toUpperCase()}</AvatarFallback>
                                        </Avatar>
                                        <div className="flex-grow overflow-hidden">
                                            <p className="text-sm font-medium truncate">{partner.username}</p>
                                            <div className="flex items-center gap-2">
                                                <Badge className={cn("text-xs h-auto", isBuyer ? 'bg-green-600 text-primary-foreground hover:bg-green-600/90' : 'bg-destructive text-destructive-foreground hover:bg-destructive/90')}>{isBuyer ? "Buy" : "Sell"}</Badge>
                                                <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                                                    {trade.amount.toFixed(4)} {trade.crypto}
                                                    <CryptoLogo crypto={trade.crypto as CryptoCurrency} className="h-4 w-4" />
                                                </p>
                                            </div>
                                        </div>
                                        <div className="text-right text-xs shrink-0">
                                            <p className="font-semibold">{trade.fiatAmount.toLocaleString()} {trade.fiatCurrency}</p>
                                            <Badge variant="outline" className={cn("capitalize mt-1", statusColors[trade.status])}>
                                                {trade.status}
                                            </Badge>
                                        </div>
                                    </Link>
                                </DropdownMenuItem>
                             )
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
              <Button variant="ghost" className="flex shrink-0 items-center gap-1.5 md:gap-2 p-1 h-auto rounded-md">
                {userData?.country && <FlagIcon countryCode={userData.country} className="w-5 h-auto rounded-sm" />}
                <Avatar className="h-8 w-8 shrink-0">
                  {userData?.photoURL ? (
                    <AvatarImage src={userData.photoURL} alt={authUser.displayName || 'User Avatar'} />
                  ) : (
                    <AvatarFallback className="bg-transparent">
                      <DefaultAvatar />
                    </AvatarFallback>
                  )}
                </Avatar>
                <div className="flex-shrink min-w-0 text-left">
                  {authUser?.displayName ? (
                    <p className="font-semibold text-sm leading-tight truncate">{authUser.displayName}</p>
                  ) : (
                    <Skeleton className="h-4 w-16" />
                  )}
                  <p className="text-xs leading-tight text-muted-foreground truncate">
                    {totalWalletValueConverted.toLocaleString(undefined, {
                      style: 'currency',
                      currency: preferredCurrency,
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </p>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{authUser?.displayName || 'My Account'}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/dashboard">
                  <LayoutDashboard className="mr-2 h-4 w-4" />
                  <span>Dashboard</span>
                </Link>
              </DropdownMenuItem>
               <DropdownMenuItem asChild>
                <Link href="/profile">
                  <User className="mr-2 h-4 w-4" />
                  <span>Profile</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/my-ads">
                  <FileText className="mr-2 h-4 w-4" />
                  <span>My Ads</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/trades">
                  <ArrowLeftRight className="mr-2 h-4 w-4" />
                  <span>My Trades</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/my-tickets">
                  <LifeBuoy className="mr-2 h-4 w-4" />
                  <span>My Tickets</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/settings">
                  <Settings className="mr-2 h-4 w-4" />
                  <span>Settings</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                <span>Logout</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
