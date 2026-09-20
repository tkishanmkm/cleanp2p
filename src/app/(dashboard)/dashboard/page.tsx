'use client';

import { useAuth } from '@/components/providers/auth-provider';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Minus, Plus, BookOpen, ShieldCheck, LifeBuoy, FileText, ArrowRight, ArrowLeftRight, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { BtcLogo, EthLogo, UsdtLogo, LtcLogo } from '@/components/icons';
import type { CryptoCurrency, Trade } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { usePrices } from '@/context/price-context';
import { useWallet } from '@/context/wallet-context';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { statusColors } from '@/lib/status-colors';
import { useRouter } from 'next/navigation';
import { FlagIcon } from '@/components/ui/flag-icon';
import { SUPPORTED_CRYPTOS } from '@/lib/constants';
import { supabase } from '@/lib/supabase/client';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { MiniCoinIcon } from '@/components/notifications/notification-bell';

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

export default function DashboardPage() {
  const { user: authUser, profile, isUserLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  const { prices, fiatRates } = usePrices();
  const { balances: reactiveBalances, totalConvertedValue, preferredCurrency } = useWallet();
  const exchangeRate = (fiatRates && preferredCurrency && fiatRates[preferredCurrency]) ? fiatRates[preferredCurrency] : (fiatRates?.['USD'] || 1);

  const [activeTrades, setActiveTrades] = useState<Trade[]>([]);
  const [isLoadingActiveTrades, setIsLoadingActiveTrades] = useState(true);

  useEffect(() => {
    if (!isAuthLoading && !authUser) {
      router.push('/login');
    }
  }, [authUser, isAuthLoading, router]);

  const fetchActiveTrades = useCallback(async () => {
    const currentUserId = authUser?.uid || (authUser as any)?.id;
    if (!currentUserId) {
      setActiveTrades([]);
      setIsLoadingActiveTrades(false);
      return;
    }
    setIsLoadingActiveTrades(true);
    try {
      let data: any[] | null = null;

      // 1. Fetch from secure server endpoint
      try {
        const res = await fetch('/api/trades?status=active,paid,disputed');
        if (res.ok) {
          const json = await res.json();
          if (json && Array.isArray(json.trades)) {
            data = json.trades;
          }
        }
      } catch (apiErr) {
        // Fallback
      }

      // 2. Fallback to supabase client
      if (!data) {
        const { data: clientData, error } = await supabase
          .from('trades')
          .select('*')
          .or(`buyer_id.eq.${currentUserId},seller_id.eq.${currentUserId}`)
          .order('created_at', { ascending: false });

        if (!error && clientData) {
          data = clientData;
        }
      }

      if (!data || data.length === 0) {
        setActiveTrades([]);
        setIsLoadingActiveTrades(false);
        return;
      }

      // 3. Fetch counterparty profiles for avatars and usernames
      const partnerIds = Array.from(
        new Set(
          data
            .flatMap((t: any) => [t.buyer_id, t.seller_id])
            .filter((id: any) => id && id !== currentUserId)
        )
      );

      let profileMap: Record<string, any> = {};
      if (partnerIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, username, display_name, avatar_url, photo_url, country')
          .in('id', partnerIds);

        if (profiles) {
          profiles.forEach((p: any) => {
            profileMap[p.id] = {
              username: p.username || p.display_name || 'Trader',
              avatar_url: p.avatar_url || p.photo_url || `/api/media/avatar/${p.id}`,
              country: p.country,
            };
          });
        }
      }

      const now = Date.now();
      const mapped: any[] = [];

      for (const raw of data) {
        const isBuyer = raw.buyer_id === currentUserId;
        const partnerId = isBuyer ? raw.seller_id : raw.buyer_id;
        const counterparty = profileMap[partnerId];
        const rawStatus = (raw.status || '').toLowerCase();
        const escrowStatus = (raw.escrow_status || '').toLowerCase();

        // Calculate precise effective status
        const isDisputed = Boolean(
          raw.is_disputed ||
          rawStatus === 'disputed' ||
          rawStatus === 'dispute' ||
          escrowStatus === 'disputed'
        );
        const isCompleted = Boolean(
          raw.completed_at ||
          raw.released_at ||
          rawStatus === 'completed' ||
          rawStatus === 'released' ||
          escrowStatus === 'completed' ||
          escrowStatus === 'released'
        );
        const isCancelled = Boolean(
          raw.cancelled_at ||
          rawStatus === 'cancelled' ||
          rawStatus === 'canceled' ||
          escrowStatus === 'cancelled'
        );
        const isPaid = Boolean(
          raw.paid_at ||
          raw.marked_paid_at ||
          raw.payment_confirmed_at ||
          rawStatus === 'paid' ||
          rawStatus === 'mark_paid' ||
          rawStatus === 'buyer_marked_paid' ||
          escrowStatus === 'paid'
        );
        const isExplicitExpired = Boolean(
          raw.expired_at ||
          rawStatus === 'expired' ||
          escrowStatus === 'expired'
        );

        const createdAtMs = raw.created_at ? new Date(raw.created_at).getTime() : 0;
        const winMin = Number(raw.payment_window_minutes || raw.payment_window || 30);
        const expiresAtMs = raw.expires_at ? new Date(raw.expires_at).getTime() : (createdAtMs > 0 ? createdAtMs + winMin * 60 * 1000 : 0);
        const isTimeExpired = (!isPaid && !isCompleted && !isDisputed) && (expiresAtMs > 0 && now >= expiresAtMs);

        // Filter out finalized/expired trades from active list
        if (isCompleted || isCancelled || isExplicitExpired || isTimeExpired) {
          continue;
        }

        let effectiveStatus = 'active';
        if (isDisputed) effectiveStatus = 'disputed';
        else if (isPaid) effectiveStatus = 'paid';

        const rawTradeId = raw.trade_id || raw.id;
        const shortTradeId = '#' + (rawTradeId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();

        mapped.push({
          id: raw.id,
          tradeId: shortTradeId,
          adId: raw.ad_id,
          buyerId: raw.buyer_id,
          sellerId: raw.seller_id,
          crypto: (raw.crypto || raw.crypto_currency || raw.asset_symbol || 'USDT').toUpperCase(),
          amount: Number(raw.amount || raw.crypto_amount || 0),
          fiatCurrency: (raw.fiat_currency || raw.fiat || 'USD').toUpperCase(),
          fiatAmount: Number(raw.fiat_amount || raw.fiatAmount || 0),
          price: Number(raw.price || 0),
          paymentMethod: raw.payment_method || raw.paymentMethod || 'Bank Transfer',
          status: effectiveStatus,
          createdAt: raw.created_at,
          isBuyer,
          buyer: isBuyer ? { id: currentUserId, username: authUser?.displayName || 'You' } : { id: partnerId, username: counterparty?.username || 'Buyer', avatar_url: counterparty?.avatar_url, country: counterparty?.country },
          seller: !isBuyer ? { id: currentUserId, username: authUser?.displayName || 'You' } : { id: partnerId, username: counterparty?.username || 'Seller', avatar_url: counterparty?.avatar_url, country: counterparty?.country },
          counterpartyUsername: counterparty?.username || (isBuyer ? raw.seller_username : raw.buyer_username) || 'Trader',
          counterpartyAvatar: counterparty?.avatar_url || null,
          counterpartyCountry: counterparty?.country || null,
        });
      }

      setActiveTrades(mapped);
    } catch (err) {
      console.error('Error fetching active trades on dashboard:', err);
    } finally {
      setIsLoadingActiveTrades(false);
    }
  }, [authUser?.uid, (authUser as any)?.id, authUser?.displayName]);

  useEffect(() => {
    fetchActiveTrades();
  }, [fetchActiveTrades]);

  // Unified balance list from reactive state
  const unifiedWallets = useMemo(() => {
    return SUPPORTED_CRYPTOS.map((crypto) => {
      const coin = crypto.name;
      const walletData = reactiveBalances?.[coin] || { available: 0, fiatValue: 0 };
      return {
        crypto: coin,
        balance: typeof walletData.available === 'number' ? walletData.available : 0,
        fiatValue: typeof walletData.fiatValue === 'number' ? walletData.fiatValue : 0,
      };
    });
  }, [reactiveBalances]);

  // For the dashboard table, show active wallets or all supported cryptos
  const walletsToShow = useMemo(() => {
    const active = unifiedWallets.filter((w) => (w?.balance || 0) > 0);
    return active.length > 0 ? active : unifiedWallets;
  }, [unifiedWallets]);

  const totalWalletValueConverted = totalConvertedValue;

  if (isAuthLoading || (!authUser && typeof window !== 'undefined')) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-[300px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!authUser) {
    return null;
  }

  return (
    <>
      <div className="flex flex-col gap-2 mb-6">
        {isAuthLoading ? (
          <Skeleton className="h-9 w-64" />
        ) : (
          <h1 className="text-2xl font-semibold md:text-3xl">
            Welcome back, {profile?.username || authUser?.displayName || 'Trader'}!
          </h1>
        )}
        <p className="text-muted-foreground">Here's a complete overview of your P2P trading activity.</p>
      </div>

      <div className="grid gap-4 md:gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-8">
          <Card>
            <CardHeader className="flex flex-row items-center">
              <div className="grid gap-2">
                <CardTitle>Unified Balance</CardTitle>
                <CardDescription>
                  Total estimated value:{' '}
                  {totalWalletValueConverted.toLocaleString(undefined, {
                    style: 'currency',
                    currency: preferredCurrency,
                    minimumFractionDigits: 2,
                  })}
                </CardDescription>
              </div>
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="outline" asChild>
                  <Link href="/wallets">
                    <Minus className="h-4 w-4 mr-1" /> Withdraw
                  </Link>
                </Button>
                <Button size="sm" asChild>
                  <Link href="/wallets">
                    <Plus className="h-4 w-4 mr-1" /> Deposit
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isAuthLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <>
                  <Table className="hidden md:table">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Asset</TableHead>
                        <TableHead>Available Balance</TableHead>
                        <TableHead className="text-right">{preferredCurrency} Value</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {walletsToShow.map((wallet) => {
                        const valueUSD = (wallet.balance || 0) * (prices[wallet.crypto] || 0);
                        const valueConverted = valueUSD * exchangeRate;
                        return (
                          <TableRow key={wallet.crypto}>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <CryptoLogo crypto={wallet.crypto} />
                                <span className="font-medium">{wallet.crypto}</span>
                              </div>
                            </TableCell>
                            <TableCell className="font-mono font-medium">{(wallet.balance || 0).toFixed(8)}</TableCell>
                            <TableCell className="text-right font-medium">
                              {valueConverted.toLocaleString(undefined, {
                                style: 'currency',
                                currency: preferredCurrency,
                                minimumFractionDigits: 2,
                              })}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {(!walletsToShow || walletsToShow.length === 0) && (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-muted-foreground py-10">
                            No funds detected. Deposit crypto to start trading.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                  <div className="md:hidden space-y-4">
                    {walletsToShow.map((wallet) => {
                      const valueUSD = (wallet.balance || 0) * (prices[wallet.crypto] || 0);
                      const valueConverted = valueUSD * exchangeRate;
                      return (
                        <Card key={wallet.crypto}>
                          <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <div className="flex items-center gap-2">
                              <CryptoLogo crypto={wallet.crypto} />
                              <CardTitle className="text-lg">{wallet.crypto}</CardTitle>
                            </div>
                            <div className="font-semibold text-right">
                              {valueConverted.toLocaleString(undefined, {
                                style: 'currency',
                                currency: preferredCurrency,
                                minimumFractionDigits: 2,
                              })}
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-1 text-sm">
                            <div className="flex justify-between items-center">
                              <span className="text-muted-foreground">Available</span>
                              <span className="font-mono font-medium">{(wallet.balance || 0).toFixed(8)}</span>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                    {(!walletsToShow || walletsToShow.length === 0) && (
                      <div className="text-center text-muted-foreground py-10">No funds detected.</div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border border-border shadow-xs overflow-hidden">
            <CardHeader className="bg-muted/10 border-b border-border/40 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-bold text-foreground">Active Trades</CardTitle>
                  <CardDescription className="text-xs text-muted-foreground mt-0.5">
                    Trades that require your immediate payment, confirmation, or release.
                  </CardDescription>
                </div>
                {activeTrades.length > 0 && (
                  <Badge variant="outline" className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30 text-xs font-semibold">
                    {activeTrades.length} Active
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {isLoadingActiveTrades && (
                <div className="p-6 space-y-3">
                  <Skeleton className="h-14 w-full rounded-xl" />
                  <Skeleton className="h-14 w-full rounded-xl" />
                </div>
              )}

              {!isLoadingActiveTrades && activeTrades.length > 0 && (
                <>
                  {/* Desktop Table View */}
                  <Table className="hidden md:table">
                    <TableHeader className="bg-muted/20">
                      <TableRow>
                        <TableHead className="text-xs font-semibold">Trade & Partner</TableHead>
                        <TableHead className="text-xs font-semibold">Crypto Amount</TableHead>
                        <TableHead className="text-xs font-semibold">Fiat Total</TableHead>
                        <TableHead className="text-xs font-semibold">Payment Method</TableHead>
                        <TableHead className="text-xs font-semibold">Status</TableHead>
                        <TableHead className="text-right text-xs font-semibold">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="divide-y divide-border/40">
                      {activeTrades.map((trade: any) => {
                        return (
                          <TableRow key={trade.id} className="hover:bg-muted/30 transition-colors">
                            {/* Partner & DP */}
                            <TableCell className="py-3">
                              <div className="flex items-center gap-2.5">
                                <Avatar className="h-8 w-8 rounded-full border border-border shrink-0">
                                  {trade.counterpartyAvatar && (
                                    <AvatarImage src={trade.counterpartyAvatar} alt={trade.counterpartyUsername} />
                                  )}
                                  <AvatarFallback className="bg-muted text-foreground font-bold text-[11px]">
                                    {(trade.counterpartyUsername || 'TR').substring(0, 2).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <span className={cn(
                                      "text-[10px] font-bold px-1.5 py-0.2 rounded leading-tight",
                                      trade.isBuyer
                                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                        : "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                                    )}>
                                      {trade.isBuyer ? 'BUY' : 'SELL'}
                                    </span>
                                    <span className="font-semibold text-xs text-foreground">
                                      @{trade.counterpartyUsername}
                                    </span>
                                  </div>
                                  <span className="text-[10px] text-muted-foreground font-mono">
                                    {trade.tradeId}
                                  </span>
                                </div>
                              </div>
                            </TableCell>

                            {/* Crypto Amount with MiniCoinIcon */}
                            <TableCell className="py-3">
                              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                <MiniCoinIcon symbol={trade.crypto} className="h-4 w-4 shrink-0" />
                                <span>{trade.amount.toFixed(4)} {trade.crypto}</span>
                              </div>
                            </TableCell>

                            {/* Fiat Total */}
                            <TableCell className="py-3">
                              <span className="text-xs font-mono font-medium text-foreground">
                                {trade.fiatAmount.toLocaleString()} {trade.fiatCurrency}
                              </span>
                            </TableCell>

                            {/* Payment Method */}
                            <TableCell className="py-3">
                              <span className="px-2 py-0.5 text-[11px] font-medium rounded-md bg-muted text-foreground border border-border/50">
                                {trade.paymentMethod}
                              </span>
                            </TableCell>

                            {/* Status Badge */}
                            <TableCell className="py-3">
                              <Badge variant="outline" className={cn('capitalize text-xs font-semibold', statusColors[trade.status])}>
                                {trade.status === 'paid' ? 'Marked Paid' : trade.status}
                              </Badge>
                            </TableCell>

                            {/* Action Button */}
                            <TableCell className="text-right py-3">
                              <Button asChild variant="outline" size="sm" className="h-8 text-xs font-medium rounded-lg">
                                <Link href={`/trade/${trade.id}`}>
                                  Open Trade <ArrowRight className="ml-1.5 h-3 w-3" />
                                </Link>
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>

                  {/* Mobile Card View */}
                  <div className="grid gap-3 p-3 md:hidden">
                    {activeTrades.map((trade: any) => {
                      return (
                        <div key={trade.id} className="p-3.5 rounded-xl border border-border/70 bg-card/60 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Avatar className="h-8 w-8 rounded-full border border-border shrink-0">
                                {trade.counterpartyAvatar && (
                                  <AvatarImage src={trade.counterpartyAvatar} alt={trade.counterpartyUsername} />
                                )}
                                <AvatarFallback className="bg-muted text-foreground font-bold text-[11px]">
                                  {(trade.counterpartyUsername || 'TR').substring(0, 2).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <span className={cn(
                                    "text-[10px] font-bold px-1.5 py-0.2 rounded leading-tight",
                                    trade.isBuyer
                                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                      : "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                                  )}>
                                    {trade.isBuyer ? 'BUY' : 'SELL'}
                                  </span>
                                  <span className="font-semibold text-xs text-foreground">
                                    @{trade.counterpartyUsername}
                                  </span>
                                </div>
                                <span className="text-[10px] text-muted-foreground font-mono">
                                  {trade.tradeId}
                                </span>
                              </div>
                            </div>

                            <Badge variant="outline" className={cn('capitalize text-xs font-semibold', statusColors[trade.status])}>
                              {trade.status === 'paid' ? 'Marked Paid' : trade.status}
                            </Badge>
                          </div>

                          <div className="flex items-center justify-between pt-1 border-t border-border/40 text-xs">
                            <div className="flex items-center gap-1.5 font-semibold text-foreground">
                              <MiniCoinIcon symbol={trade.crypto} className="h-3.5 w-3.5" />
                              <span>{trade.amount.toFixed(4)} {trade.crypto}</span>
                              <span className="text-muted-foreground font-normal">≈</span>
                              <span className="font-mono text-muted-foreground">{trade.fiatAmount.toLocaleString()} {trade.fiatCurrency}</span>
                            </div>

                            <span className="px-1.5 py-0.2 text-[10px] font-medium rounded bg-muted text-foreground">
                              {trade.paymentMethod}
                            </span>
                          </div>

                          <Button asChild variant="secondary" className="w-full h-8 text-xs font-medium rounded-lg">
                            <Link href={`/trade/${trade.id}`}>View Trade Details →</Link>
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {!isLoadingActiveTrades && activeTrades.length === 0 && (
                <div className="text-center text-muted-foreground py-10">
                  <ArrowLeftRight className="mx-auto h-10 w-10 text-muted-foreground/40 mb-2" />
                  <h3 className="text-sm font-semibold text-foreground">No Active Trades</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">You have no trades that require immediate action.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Platform Resources</CardTitle>
              <CardDescription>Get help and read our policies.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <Link
                href="/faq"
                className="flex items-center gap-4 p-4 rounded-lg hover:bg-muted/50 transition-colors border"
              >
                <LifeBuoy className="h-8 w-8 text-primary" />
                <div>
                  <h3 className="font-semibold">FAQ</h3>
                  <p className="text-sm text-muted-foreground">Common questions.</p>
                </div>
              </Link>
              <Link
                href="/guides"
                className="flex items-center gap-4 p-4 rounded-lg hover:bg-muted/50 transition-colors border"
              >
                <BookOpen className="h-8 w-8 text-primary" />
                <div>
                  <h3 className="font-semibold">Guides</h3>
                  <p className="text-sm text-muted-foreground">Learn how to trade.</p>
                </div>
              </Link>
              <Link
                href="/terms"
                className="flex items-center gap-4 p-4 rounded-lg hover:bg-muted/50 transition-colors border"
              >
                <FileText className="h-8 w-8 text-primary" />
                <div>
                  <h3 className="font-semibold">Terms</h3>
                  <p className="text-sm text-muted-foreground">Platform rules.</p>
                </div>
              </Link>
              <Link
                href="/policy"
                className="flex items-center gap-4 p-4 rounded-lg hover:bg-muted/50 transition-colors border"
              >
                <ShieldCheck className="h-8 w-8 text-primary" />
                <div>
                  <h3 className="font-semibold">Privacy</h3>
                  <p className="text-sm text-muted-foreground">Your data safety.</p>
                </div>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
