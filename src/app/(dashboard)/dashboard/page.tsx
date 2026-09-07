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
  const { prices } = usePrices();
  const { balances: reactiveBalances, totalConvertedValue, preferredCurrency } = useWallet();

  const [activeTrades, setActiveTrades] = useState<Trade[]>([]);
  const [isLoadingActiveTrades, setIsLoadingActiveTrades] = useState(true);

  useEffect(() => {
    if (!isAuthLoading && !authUser) {
      router.push('/login');
    }
  }, [authUser, isAuthLoading, router]);

  const fetchActiveTrades = useCallback(async () => {
    if (!authUser?.uid) {
      setActiveTrades([]);
      setIsLoadingActiveTrades(false);
      return;
    }
    setIsLoadingActiveTrades(true);
    try {
      const { data, error } = await supabase
        .from('trades')
        .select('*')
        .or(`buyer_id.eq.${authUser.uid},seller_id.eq.${authUser.uid}`)
        .in('status', ['active', 'paid', 'disputed'])
        .order('created_at', { ascending: false });

      if (error) throw error;

      const mapped: Trade[] = (data || []).map((raw: any) => ({
        id: raw.id,
        tradeId: raw.trade_id || raw.id,
        adId: raw.ad_id,
        buyerId: raw.buyer_id,
        sellerId: raw.seller_id,
        crypto: raw.crypto,
        amount: Number(raw.amount || 0),
        fiatCurrency: raw.fiat_currency,
        fiatAmount: Number(raw.fiat_amount || 0),
        price: Number(raw.price || 0),
        status: raw.status || 'active',
        createdAt: raw.created_at,
        buyer: raw.buyer || { id: raw.buyer_id, username: raw.buyer_username || 'Buyer' },
        seller: raw.seller || { id: raw.seller_id, username: raw.seller_username || 'Seller' },
      }));

      setActiveTrades(mapped);
    } catch (err) {
      console.error('Error fetching active trades on dashboard:', err);
    } finally {
      setIsLoadingActiveTrades(false);
    }
  }, [authUser?.uid]);

  useEffect(() => {
    fetchActiveTrades();
  }, [fetchActiveTrades]);

  // Unified balance list from reactive state
  const unifiedWallets = useMemo(() => {
    return SUPPORTED_CRYPTOS.map((crypto) => {
      const coin = crypto.name;
      const walletData = reactiveBalances?.[coin] || { available: 0, inEscrow: 0, inWithdrawal: 0, fiatValue: 0 };
      return {
        crypto: coin,
        balance: typeof walletData.available === 'number' ? walletData.available : 0,
        lockedBalance: typeof walletData.inEscrow === 'number' ? walletData.inEscrow : 0,
        inWithdrawal: typeof walletData.inWithdrawal === 'number' ? walletData.inWithdrawal : 0,
        fiatValue: typeof walletData.fiatValue === 'number' ? walletData.fiatValue : 0,
      };
    });
  }, [reactiveBalances]);

  // For the dashboard table, show active wallets or all supported cryptos
  const walletsToShow = useMemo(() => {
    const active = unifiedWallets.filter((w) => (w?.balance || 0) > 0 || (w?.lockedBalance || 0) > 0 || (w?.inWithdrawal || 0) > 0);
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
                        <TableHead>Available</TableHead>
                        <TableHead>In Escrow</TableHead>
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
                            <TableCell>{(wallet.balance || 0).toFixed(8)}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {(wallet.lockedBalance || 0).toFixed(8)}
                            </TableCell>
                            <TableCell className="text-right">
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
                          <TableCell colSpan={4} className="text-center text-muted-foreground py-10">
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
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Available</span>
                              <span>{(wallet.balance || 0).toFixed(8)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">In Escrow</span>
                              <span>{(wallet.lockedBalance || 0).toFixed(8)}</span>
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

          <Card>
            <CardHeader>
              <CardTitle>Active Trades</CardTitle>
              <CardDescription>Trades that require your attention.</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingActiveTrades && <Skeleton className="h-24 w-full" />}
              {!isLoadingActiveTrades && activeTrades.length > 0 && (
                <>
                  <Table className="hidden md:table">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Partner</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeTrades.map((trade) => {
                        const isBuyer = trade.buyerId === authUser?.uid;
                        const partner = isBuyer ? trade.seller : trade.buyer;
                        return (
                          <TableRow key={trade.id}>
                            <TableCell>
                              <div className="flex items-center gap-2 font-medium">
                                {partner?.username}
                                {partner?.country && <FlagIcon countryCode={partner.country} />}
                              </div>
                            </TableCell>
                            <TableCell>
                              {trade.amount.toFixed(6)} {trade.crypto}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={cn('capitalize', statusColors[trade.status])}>
                                {trade.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button asChild variant="outline" size="sm">
                                <Link href={`/trade/${trade.id}`}>
                                  View Trade <ArrowRight className="ml-2 h-3 w-3" />
                                </Link>
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  <div className="grid gap-4 md:hidden">
                    {activeTrades.map((trade) => {
                      const isBuyer = trade.buyerId === authUser?.uid;
                      const partner = isBuyer ? trade.seller : trade.buyer;
                      return (
                        <Card key={trade.id}>
                          <CardHeader>
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-base">
                                {trade.amount.toFixed(4)} {trade.crypto}
                              </CardTitle>
                              <Badge variant="outline" className={cn('capitalize', statusColors[trade.status])}>
                                {trade.status}
                              </Badge>
                            </div>
                            <CardDescription>
                              Partner: {partner?.username}
                              {partner?.country && <FlagIcon countryCode={partner.country} className="inline ml-2" />}
                            </CardDescription>
                          </CardHeader>
                          <CardFooter>
                            <Button asChild variant="secondary" className="w-full">
                              <Link href={`/trade/${trade.id}`}>View Trade</Link>
                            </Button>
                          </CardFooter>
                        </Card>
                      );
                    })}
                  </div>
                </>
              )}
              {!isLoadingActiveTrades && activeTrades.length === 0 && (
                <div className="text-center text-muted-foreground py-10 border-2 border-dashed rounded-lg">
                  <ArrowLeftRight className="mx-auto h-12 w-12 text-muted-foreground/50" />
                  <h3 className="mt-4 text-lg font-semibold">No Active Trades</h3>
                  <p className="mt-1 text-sm">You have no trades that require immediate action.</p>
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
