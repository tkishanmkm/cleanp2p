'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import type { CoinTransfer, CryptoCurrency } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowDown, ArrowUp, Eye } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { DepositDialog } from '@/components/wallets/deposit-dialog';
import { WithdrawDialog } from '@/components/wallets/withdraw-dialog';
import { BtcLogo, EthLogo, LtcLogo, UsdtLogo } from '@/components/icons';
import { cancelWithdrawalRequest, getUserWalletBalances } from '@/lib/wallet';
import { getUserDeposits, getUserWithdrawals, type DepositRecord, type WithdrawalRecord } from '@/lib/supabase/db';
import { SUPPORTED_CRYPTOS } from '@/lib/constants';
import { usePrices } from '@/context/price-context';
import { statusColors } from '@/lib/status-colors';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TransferHistoryTable } from '@/components/wallets/transfer-history-table';

const depositStatusText: Record<string, string> = {
  pending: 'Confirming on Blockchain',
  detected: 'Detected on Chain',
  confirmed: 'Confirmed',
  credited: 'Credited',
  approved: 'Credited',
  rejected: 'Rejected',
  declined: 'Cancelled',
  expired: 'Expired',
  awaiting_confirmation: 'Waiting for Confirmations',
};

interface DisplayDeposit {
  id: string;
  crypto: CryptoCurrency;
  chain: string;
  amount: number;
  status: string;
  createdAt: Date | string | null;
  walletAddress?: string;
  txid?: string;
}

interface DisplayWithdrawal {
  id: string;
  crypto: CryptoCurrency;
  chain: string;
  amount: number;
  status: string;
  createdAt: Date | string | null;
  address?: string;
  txid?: string;
}

function DepositsHistory({ userId, onRowClick }: { userId: string; onRowClick: (deposit: DisplayDeposit) => void }) {
  const [deposits, setDeposits] = useState<DisplayDeposit[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadDeposits = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    try {
      const { data, error } = await getUserDeposits(userId);
      if (!error && data) {
        const mapped: DisplayDeposit[] = data.map((d: DepositRecord) => ({
          id: d.id,
          crypto: d.asset_code as CryptoCurrency,
          chain: d.network_code,
          amount: Number(d.amount),
          status: d.status,
          createdAt: d.created_at,
          txid: d.txid,
        }));
        setDeposits(mapped);
      }
    } catch (err) {
      console.warn('Could not fetch Supabase deposits:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadDeposits();
  }, [loadDeposits]);

  if (isLoading)
    return (
      <div className="space-y-2">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  if (!deposits?.length) return <p className="text-center text-muted-foreground py-4">No deposit history.</p>;

  return (
    <ScrollArea className="h-72">
      <Table className="hidden md:table">
        <TableHeader>
          <TableRow>
            <TableHead>Asset</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {deposits.map((d) => {
            const displayStatus = depositStatusText[d.status] || d.status;
            const dateStr = d.createdAt ? new Date(d.createdAt).toLocaleDateString() : 'N/A';
            return (
              <TableRow key={d.id} onClick={() => onRowClick(d)} className="cursor-pointer hover:bg-muted/50">
                <TableCell>
                  {d.crypto} <span className="text-muted-foreground text-xs">({d.chain})</span>
                </TableCell>
                <TableCell className="font-medium">{d.amount}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn('capitalize text-xs', statusColors[d.status] || 'bg-muted text-muted-foreground')}
                  >
                    {displayStatus}
                  </Badge>
                </TableCell>
                <TableCell>{dateStr}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon">
                    <Eye className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="grid gap-4 md:hidden p-2">
        {deposits.map((d) => (
          <Card key={d.id} onClick={() => onRowClick(d)} className="cursor-pointer">
            <CardHeader className="p-4">
              <div className="flex justify-between items-start">
                <CardTitle className="text-base">
                  {d.amount} {d.crypto}
                </CardTitle>
                <Badge variant="outline" className="text-[10px]">
                  {d.status}
                </Badge>
              </div>
              <CardDescription className="text-xs">{d.chain}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </ScrollArea>
  );
}

function WithdrawalsHistory({
  userId,
  onRowClick,
}: {
  userId: string;
  onRowClick: (withdrawal: DisplayWithdrawal) => void;
}) {
  const [withdrawals, setWithdrawals] = useState<DisplayWithdrawal[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadWithdrawals = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    try {
      const { data, error } = await getUserWithdrawals(userId);
      if (!error && data) {
        const mapped: DisplayWithdrawal[] = data.map((w: WithdrawalRecord) => ({
          id: w.id,
          crypto: w.asset_code as CryptoCurrency,
          chain: w.network_code,
          amount: Number(w.amount),
          status: w.status,
          createdAt: w.created_at,
          address: w.destination_address,
          txid: w.txid || undefined,
        }));
        setWithdrawals(mapped);
      }
    } catch (err) {
      console.warn('Could not fetch Supabase withdrawals:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadWithdrawals();
  }, [loadWithdrawals]);

  if (isLoading)
    return (
      <div className="space-y-2">
        <Skeleton className="h-24 w-full" />
      </div>
    );
  if (!withdrawals?.length) return <p className="text-center text-muted-foreground py-4">No withdrawal history.</p>;

  return (
    <ScrollArea className="h-72">
      <Table className="hidden md:table">
        <TableHeader>
          <TableRow>
            <TableHead>Asset</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {withdrawals.map((w) => {
            const dateStr = w.createdAt ? new Date(w.createdAt).toLocaleDateString() : 'N/A';
            return (
              <TableRow key={w.id} onClick={() => onRowClick(w)} className="cursor-pointer hover:bg-muted/50">
                <TableCell>
                  {w.crypto} <span className="text-muted-foreground text-xs">({w.chain})</span>
                </TableCell>
                <TableCell className="font-medium">{w.amount}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn('capitalize text-xs', statusColors[w.status] || 'bg-muted text-muted-foreground')}
                  >
                    {w.status}
                  </Badge>
                </TableCell>
                <TableCell>{dateStr}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon">
                    <Eye className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="grid gap-4 md:hidden p-2">
        {withdrawals.map((w) => (
          <Card key={w.id} onClick={() => onRowClick(w)} className="cursor-pointer">
            <CardHeader className="p-4">
              <div className="flex justify-between items-start">
                <CardTitle className="text-base">
                  {w.amount} {w.crypto}
                </CardTitle>
                <Badge variant="outline" className="text-[10px]">
                  {w.status}
                </Badge>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>
    </ScrollArea>
  );
}

export default function WalletPage() {
  const { user, profile, isUserLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { prices, fiatRates } = usePrices();

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  const [supabaseBalances, setSupabaseBalances] = useState<{
    [key in CryptoCurrency]?: { balance: number; lockedBalance: number };
  } | null>(null);

  const [selectedTx, setSelectedTx] = useState<DisplayDeposit | DisplayWithdrawal | null>(null);
  const [activeDialogAsset, setActiveDialogAsset] = useState<CryptoCurrency | null>(null);
  const [, setSelectedTransfer] = useState<CoinTransfer | null>(null);

  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);

  // Fetch real-time balances from Supabase
  const loadBalances = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const balances = await getUserWalletBalances(user.uid);
      if (balances && Object.keys(balances).length > 0) {
        setSupabaseBalances(balances);
      }
    } catch (err) {
      console.error('Could not load real-time wallet balances:', err);
    }
  }, [user?.uid]);

  useEffect(() => {
    loadBalances();
  }, [loadBalances]);

  // Aggregate summary from Supabase balances
  const walletSummary = useMemo(() => {
    const preferredCurrency = profile?.preferredCurrency || 'USD';
    const exchangeRate = fiatRates[preferredCurrency] || 1;

    return SUPPORTED_CRYPTOS.map((crypto) => {
      const coin = crypto.name;
      const walletData = supabaseBalances?.[coin] || { balance: 0, lockedBalance: 0 };
      const priceInUsd = prices[coin] || 0;
      const availableBalance = typeof walletData.balance === 'number' ? walletData.balance : 0;
      const lockedBalance = typeof walletData.lockedBalance === 'number' ? walletData.lockedBalance : 0;
      const fiatValue = availableBalance * priceInUsd * exchangeRate;

      return {
        coin,
        availableBalance,
        lockedBalance,
        fiatValue,
      };
    }).sort((a, b) => b.fiatValue - a.fiatValue);
  }, [supabaseBalances, profile, prices, fiatRates]);

  const totalAvailableValue = useMemo(
    () => walletSummary.reduce((acc, w) => acc + (w?.fiatValue || 0), 0),
    [walletSummary]
  );

  const handleDepositClick = (coin: CryptoCurrency) => {
    setActiveDialogAsset(coin);
    setIsDepositOpen(true);
  };

  const handleWithdrawClick = (coin: CryptoCurrency) => {
    setActiveDialogAsset(coin);
    setIsWithdrawOpen(true);
  };

  const handleHistoryRowClick = (tx: DisplayDeposit | DisplayWithdrawal) => {
    setSelectedTx(tx);
    setIsDetailsOpen(true);
  };

  const handleCancelWithdrawal = async (withdrawal: DisplayWithdrawal) => {
    if (!user || !withdrawal) return;
    try {
      await cancelWithdrawalRequest(null, user.uid, withdrawal.id);
      toast({ title: 'Withdrawal Cancelled' });
      setIsDetailsOpen(false);
      loadBalances();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Cancellation Failed', description: e?.message || 'Failed to cancel' });
    }
  };

  if (isUserLoading || (!user && typeof window !== 'undefined')) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-[300px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const CoinLogo = ({ coin, className }: { coin: string; className?: string }) => {
    switch (coin) {
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

  // Convert balances into the format expected by WithdrawDialog
  const userWalletsFormatted: Record<string, { balance: number; address: string }> = {};
  if (supabaseBalances) {
    for (const [key, val] of Object.entries(supabaseBalances)) {
      userWalletsFormatted[key] = { balance: val?.balance || 0, address: '' };
    }
  }

  return (
    <>
      <DepositDialog
        open={isDepositOpen}
        onOpenChange={(isOpen) => {
          setIsDepositOpen(isOpen);
          if (!isOpen) setActiveDialogAsset(null);
        }}
        asset={activeDialogAsset}
      />
      <WithdrawDialog
        open={isWithdrawOpen}
        onOpenChange={(isOpen) => {
          setIsWithdrawOpen(isOpen);
          if (!isOpen) setActiveDialogAsset(null);
        }}
        asset={activeDialogAsset}
        userWallets={userWalletsFormatted as any}
      />

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold md:text-2xl">Unified Wallets</h1>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Total Available Value</p>
          <p className="text-xl font-bold">
            {totalAvailableValue.toLocaleString(undefined, {
              style: 'currency',
              currency: profile?.preferredCurrency || 'USD',
            })}
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4 mb-8">
        {walletSummary.map((data) => (
          <Card key={data.coin}>
            <CardHeader className="flex flex-row items-start justify-between pb-2">
              <CardTitle className="text-xl font-bold">{data.coin}</CardTitle>
              <CoinLogo coin={data.coin} className="h-8 w-8" />
            </CardHeader>
            <CardContent className="space-y-2">
              <div>
                <div className="text-3xl font-bold">{data.availableBalance.toFixed(6)}</div>
                <p className="text-xs text-muted-foreground">
                  ≈{' '}
                  {data.fiatValue.toLocaleString(undefined, {
                    style: 'currency',
                    currency: profile?.preferredCurrency || 'USD',
                  })}
                </p>
              </div>
              {data.lockedBalance > 0 && (
                <p className="text-[10px] text-amber-600 font-medium">In Escrow: {data.lockedBalance.toFixed(6)}</p>
              )}
            </CardContent>
            <CardFooter className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={() => handleDepositClick(data.coin as CryptoCurrency)}>
                <ArrowDown className="mr-1 h-4 w-4" />
                Deposit
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => handleWithdrawClick(data.coin as CryptoCurrency)}
              >
                <ArrowUp className="mr-1 h-4 w-4" />
                Withdraw
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Transaction History</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="deposits">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="deposits">Deposits</TabsTrigger>
              <TabsTrigger value="withdrawals">Withdrawals</TabsTrigger>
              <TabsTrigger value="transfers">Transfers</TabsTrigger>
            </TabsList>
            <TabsContent value="deposits" className="mt-4">
              <DepositsHistory userId={user.uid} onRowClick={handleHistoryRowClick} />
            </TabsContent>
            <TabsContent value="withdrawals" className="mt-4">
              <WithdrawalsHistory userId={user.uid} onRowClick={handleHistoryRowClick} />
            </TabsContent>
            <TabsContent value="transfers" className="mt-4">
              <TransferHistoryTable
                userId={user.uid}
                type="received"
                onRowClick={(t) => {
                  setSelectedTransfer(t);
                }}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transaction Details</DialogTitle>
          </DialogHeader>
          {selectedTx && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Type:</span>{' '}
                <span>{'walletAddress' in selectedTx || 'txid' in selectedTx ? 'Deposit' : 'Withdrawal'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount:</span>{' '}
                <span className="font-medium">
                  {selectedTx.amount} {selectedTx.crypto}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status:</span> <Badge variant="outline">{selectedTx.status}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Network:</span> <span>{selectedTx.chain}</span>
              </div>
              {('walletAddress' in selectedTx || 'address' in selectedTx) && (
                <div className="flex justify-between items-start gap-4">
                  <span className="text-muted-foreground">Address:</span>
                  <span className="font-mono text-xs break-all text-right">
                    {'walletAddress' in selectedTx ? selectedTx.walletAddress : (selectedTx as DisplayWithdrawal).address}
                  </span>
                </div>
              )}
              {selectedTx.txid && (
                <div className="flex justify-between items-start gap-4">
                  <span className="text-muted-foreground">TxID:</span>
                  <span className="font-mono text-xs break-all text-right">{selectedTx.txid}</span>
                </div>
              )}
            </div>
          )}
          {selectedTx && 'address' in selectedTx && selectedTx.status === 'pending' && (
            <Button
              variant="destructive"
              className="w-full mt-4"
              onClick={() => handleCancelWithdrawal(selectedTx as DisplayWithdrawal)}
            >
              Cancel Withdrawal
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
