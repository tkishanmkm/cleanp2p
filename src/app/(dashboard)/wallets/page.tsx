'use client';

import { useState, useMemo } from 'react';
import { useFirebase, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { collection, query, where, orderBy, doc } from 'firebase/firestore';
import type { Deposit, Withdrawal, User, CoinTransfer, CryptoCurrency } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowDown, ArrowUp, Copy, Eye } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { toDate, cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Skeleton } from '@/components/ui/skeleton';
import { DepositDialog } from '@/components/wallets/deposit-dialog';
import { WithdrawDialog } from '@/components/wallets/withdraw-dialog';
import { BtcLogo, EthLogo, LtcLogo, UsdtLogo } from '@/components/icons';
import { cancelWithdrawalRequest } from '@/lib/wallet';
import { FIXED_WITHDRAWAL_FEES_USD, SUPPORTED_CRYPTOS } from '@/lib/constants';
import { usePrices } from '@/context/price-context';
import { statusColors } from '@/lib/status-colors';
import { isPast } from 'date-fns';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TransferHistoryTable } from '@/components/wallets/transfer-history-table';

const depositStatusText: Record<Deposit['status'], string> = {
  pending: "Pending User Action",
  awaiting_confirmation: "Waiting for Approval",
  approved: "Approved",
  declined: "Cancelled by Admin",
  expired: "Expired",
};

function DepositsHistory({ userId, onRowClick }: { userId: string, onRowClick: (deposit: Deposit) => void }) {
  const { firestore } = useFirebase();
  const depositsQuery = useMemoFirebase(() =>
      firestore ? query(collection(firestore, 'deposits'), where('userId', '==', userId)) : null,
      [firestore, userId]
  );
  const { data: deposits, isLoading } = useCollection<Deposit>(depositsQuery);

  const sortedDeposits = useMemo(() => {
      if (!deposits) return null;
      return [...deposits].sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
  }, [deposits]);

  if (isLoading) return <div className="space-y-2"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>;
  if (!sortedDeposits?.length) return <p className="text-center text-muted-foreground py-4">No deposit history.</p>;

  return (
    <ScrollArea className="h-72">
        <Table className="hidden md:table">
            <TableHeader><TableRow><TableHead>Asset</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
            <TableBody>
                {sortedDeposits.map(d => {
                    const isExpired = d.status === 'pending' && isPast(toDate(d.timerEnd)!);
                    const currentStatus = isExpired ? 'expired' : d.status;
                    return (
                        <TableRow key={d.id} onClick={() => onRowClick(d)} className="cursor-pointer hover:bg-muted/50">
                            <TableCell>{d.crypto} <span className="text-muted-foreground text-xs">({d.chain})</span></TableCell>
                            <TableCell>{d.amount}</TableCell>
                            <TableCell><Badge variant="outline" className={cn("capitalize", statusColors[currentStatus])}>{depositStatusText[currentStatus]}</Badge></TableCell>
                            <TableCell>{toDate(d.createdAt)?.toLocaleDateString()}</TableCell>
                            <TableCell className="text-right"><Button variant="ghost" size="icon"><Eye className="h-4 w-4"/></Button></TableCell>
                        </TableRow>
                    )
                })}
            </TableBody>
        </Table>
        <div className="grid gap-4 md:hidden p-2">
            {sortedDeposits.map(d => (
                <Card key={d.id} onClick={() => onRowClick(d)} className="cursor-pointer">
                    <CardHeader className="p-4">
                        <div className="flex justify-between items-start">
                            <CardTitle className="text-base">{d.amount} {d.crypto}</CardTitle>
                            <Badge variant="outline" className="text-[10px]">{d.status}</Badge>
                        </div>
                        <CardDescription className="text-xs">{d.chain}</CardDescription>
                    </CardHeader>
                </Card>
            ))}
        </div>
    </ScrollArea>
  );
}

function WithdrawalsHistory({ userId, onRowClick }: { userId: string; onRowClick: (withdrawal: Withdrawal) => void }) {
    const { firestore } = useFirebase();
    const withdrawalsQuery = useMemoFirebase(() => 
        firestore ? query(collection(firestore, 'users', userId, 'withdrawals'), orderBy('createdAt', 'desc')) : null,
        [firestore, userId]
    );
    const { data: withdrawals, isLoading } = useCollection<Withdrawal>(withdrawalsQuery);

  if (isLoading) return <div className="space-y-2"><Skeleton className="h-24 w-full" /></div>;
  if (!withdrawals?.length) return <p className="text-center text-muted-foreground py-4">No withdrawal history.</p>;

  return (
    <ScrollArea className="h-72">
        <Table className="hidden md:table">
        <TableHeader><TableRow><TableHead>Asset</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
        <TableBody>
            {withdrawals.map(w => (
            <TableRow key={w.id} onClick={() => onRowClick(w)} className="cursor-pointer hover:bg-muted/50">
                <TableCell>{w.crypto} <span className="text-muted-foreground text-xs">({w.chain})</span></TableCell>
                <TableCell>{w.amount}</TableCell>
                <TableCell><Badge variant="outline" className={cn("capitalize", statusColors[w.status])}>{w.status}</Badge></TableCell>
                <TableCell>{toDate(w.createdAt)?.toLocaleDateString()}</TableCell>
                <TableCell className="text-right"><Button variant="ghost" size="icon"><Eye className="h-4 w-4"/></Button></TableCell>
            </TableRow>
            ))}
        </TableBody>
        </Table>
        <div className="grid gap-4 md:hidden p-2">
            {withdrawals.map(w => (
                <Card key={w.id} onClick={() => onRowClick(w)} className="cursor-pointer">
                    <CardHeader className="p-4">
                        <div className="flex justify-between items-start">
                            <CardTitle className="text-base">{w.amount} {w.crypto}</CardTitle>
                            <Badge variant="outline" className="text-[10px]">{w.status}</Badge>
                        </div>
                    </CardHeader>
                </Card>
            ))}
        </div>
    </ScrollArea>
  );
}

export default function WalletPage() {
  const { firestore, user, isUserLoading } = useFirebase();
  const { toast } = useToast();
  const { prices, fiatRates } = usePrices();

  const userDocRef = useMemoFirebase(() => (user ? doc(firestore, "users", user.uid) : null), [firestore, user]);
  const { data: userData, isLoading: isUserDocLoading } = useDoc<User>(userDocRef);

  const [selectedTx, setSelectedTx] = useState<Deposit | Withdrawal | null>(null);
  const [activeDialogAsset, setActiveDialogAsset] = useState<CryptoCurrency | null>(null);
  const [initialDepositForDialog, setInitialDepositForDialog] = useState<Deposit | null>(null);
  const [selectedTransfer, setSelectedTransfer] = useState<CoinTransfer | null>(null);
  
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [isTransferDetailsOpen, setIsTransferDetailsOpen] = useState(false);

  const isLoading = isUserLoading || isUserDocLoading;

  // Aggregate summary from user document map
  const walletSummary = useMemo(() => {
    const preferredCurrency = userData?.preferredCurrency || 'USD';
    const exchangeRate = fiatRates[preferredCurrency] || 1;

    return SUPPORTED_CRYPTOS.map(crypto => {
        const coin = crypto.name;
        // Correctly handle balance lookup from the unified wallets map
        const walletData = userData?.wallets?.[coin] || { balance: 0, lockedBalance: 0 };
        const priceInUsd = prices[coin] || 0;
        const availableBalance = typeof walletData.balance === 'number' ? walletData.balance : 0;
        const lockedBalance = typeof walletData.lockedBalance === 'number' ? walletData.lockedBalance : 0;
        const fiatValue = availableBalance * priceInUsd * exchangeRate;
        
        return { 
            coin, 
            availableBalance,
            lockedBalance,
            fiatValue
        };
    }).sort((a, b) => b.fiatValue - a.fiatValue);
  }, [userData, prices, fiatRates]);

  const totalAvailableValue = useMemo(() => walletSummary.reduce((acc, w) => acc + w.fiatValue, 0), [walletSummary]);
  
  const handleDepositClick = (coin: CryptoCurrency) => {
      setActiveDialogAsset(coin);
      setIsDepositOpen(true);
  };

  const handleWithdrawClick = (coin: CryptoCurrency) => {
      setActiveDialogAsset(coin);
      setIsWithdrawOpen(true);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };
  
  const handleHistoryRowClick = (tx: Deposit | Withdrawal) => {
    const isDeposit = 'walletAddress' in tx;
    if (isDeposit && tx.status === 'pending' && !isPast(toDate(tx.timerEnd)!)) {
        setInitialDepositForDialog(tx);
        setActiveDialogAsset(tx.crypto);
        setIsDepositOpen(true);
    } else {
        setSelectedTx(tx);
        setIsDetailsOpen(true);
    }
  };

  const handleCancelWithdrawal = async (withdrawal: Withdrawal) => {
    if (!firestore || !user || !withdrawal) return;
    try {
      await cancelWithdrawalRequest(firestore, user.uid, withdrawal.id);
      toast({ title: "Withdrawal Cancelled" });
      setIsDetailsOpen(false);
    } catch(e: any) {
       toast({ variant: 'destructive', title: 'Cancellation Failed', description: e.message });
    }
  }

  if (isLoading || !user) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  
  const CoinLogo = ({ coin, className }: { coin: string, className?: string }) => {
    switch (coin) {
      case 'BTC': return <BtcLogo className={className} />;
      case 'ETH': return <EthLogo className={className} />;
      case 'LTC': return <LtcLogo className={className} />;
      case 'USDT': return <UsdtLogo className={className} />;
      default: return null;
    }
  }

  return (
    <>
      <DepositDialog 
        open={isDepositOpen} 
        onOpenChange={(isOpen) => { setIsDepositOpen(isOpen); if (!isOpen) { setInitialDepositForDialog(null); setActiveDialogAsset(null); } }} 
        asset={activeDialogAsset}
        walletIndex={userData?.walletIndex}
        initialDeposit={initialDepositForDialog}
      />
      <WithdrawDialog 
        open={isWithdrawOpen} 
        onOpenChange={(isOpen) => { setIsWithdrawOpen(isOpen); if (!isOpen) setActiveDialogAsset(null); }} 
        asset={activeDialogAsset}
        userWallets={userData?.wallets}
      />
      
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold md:text-2xl">Unified Wallets</h1>
        <div className="text-right">
            <p className="text-sm text-muted-foreground">Total Available Value</p>
            <p className="text-xl font-bold">{totalAvailableValue.toLocaleString(undefined, { style: 'currency', currency: userData?.preferredCurrency || 'USD' })}</p>
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
                  <p className="text-xs text-muted-foreground">≈ {data.fiatValue.toLocaleString(undefined, { style: 'currency', currency: userData?.preferredCurrency || 'USD' })}</p>
                </div>
                {data.lockedBalance > 0 && (
                    <p className="text-[10px] text-amber-600 font-medium">In Escrow: {data.lockedBalance.toFixed(6)}</p>
                )}
              </CardContent>
              <CardFooter className="flex gap-2">
                <Button size="sm" className="flex-1" onClick={() => handleDepositClick(data.coin as CryptoCurrency)}><ArrowDown className="mr-1 h-4 w-4" />Deposit</Button>
                <Button size="sm" variant="outline" className="flex-1" onClick={() => handleWithdrawClick(data.coin as CryptoCurrency)}><ArrowUp className="mr-1 h-4 w-4" />Withdraw</Button>
              </CardFooter>
            </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>Transaction History</CardTitle></CardHeader>
        <CardContent>
            <Tabs defaultValue="deposits">
                <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="deposits">Deposits</TabsTrigger>
                    <TabsTrigger value="withdrawals">Withdrawals</TabsTrigger>
                    <TabsTrigger value="transfers">Transfers</TabsTrigger>
                </TabsList>
                <TabsContent value="deposits" className="mt-4"><DepositsHistory userId={user.uid} onRowClick={handleHistoryRowClick} /></TabsContent>
                <TabsContent value="withdrawals" className="mt-4"><WithdrawalsHistory userId={user.uid} onRowClick={handleHistoryRowClick} /></TabsContent>
                <TabsContent value="transfers" className="mt-4">
                    <TransferHistoryTable userId={user.uid} type="received" onRowClick={(t) => { setSelectedTransfer(t); setIsTransferDetailsOpen(true); }} />
                </TabsContent>
            </Tabs>
        </CardContent>
      </Card>

      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
          <DialogContent>
              <DialogHeader><DialogTitle>Transaction Details</DialogTitle></DialogHeader>
              {selectedTx && (
                <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Type:</span> <span>{'walletAddress' in selectedTx ? 'Deposit' : 'Withdrawal'}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Amount:</span> <span className="font-medium">{selectedTx.amount} {selectedTx.crypto}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Status:</span> <Badge variant="outline">{selectedTx.status}</Badge></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Network:</span> <span>{selectedTx.chain}</span></div>
                    <div className="flex justify-between items-start gap-4">
                        <span className="text-muted-foreground">Address:</span> 
                        <span className="font-mono text-xs break-all text-right">{'walletAddress' in selectedTx ? selectedTx.walletAddress : selectedTx.address}</span>
                    </div>
                </div>
              )}
              {selectedTx && 'address' in selectedTx && selectedTx.status === 'pending' && (
                <Button variant="destructive" className="w-full mt-4" onClick={() => handleCancelWithdrawal(selectedTx as Withdrawal)}>Cancel Withdrawal</Button>
              )}
          </DialogContent>
      </Dialog>
    </>
  );
}
