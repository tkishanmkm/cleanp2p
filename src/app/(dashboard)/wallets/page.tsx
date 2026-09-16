'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import type { CoinTransfer, CryptoCurrency } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowDown, ArrowUp, Send, Eye, ExternalLink, Clock, Copy, Check } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { DepositDialog } from '@/components/wallets/deposit-dialog';
import { WithdrawDialog } from '@/components/wallets/withdraw-dialog';
import { TransferDialog } from '@/components/wallets/transfer-dialog';
import { BtcLogo, EthLogo, LtcLogo, UsdtLogo } from '@/components/icons';
import { getUserWalletBalances } from '@/lib/wallet';
import { getUserDeposits, getUserWithdrawals, type DepositRecord, type WithdrawalRecord } from '@/lib/supabase/db';
import { supabase } from '@/lib/supabase/client';
import { SUPPORTED_CRYPTOS } from '@/lib/constants';
import { usePrices } from '@/context/price-context';
import { useWallet } from '@/context/wallet-context';
import { statusColors } from '@/lib/status-colors';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TransferHistoryList } from '@/components/wallets/transfer-history-table';
import { getTxExplorerUrl, getAddressExplorerUrl } from '@/lib/explorer';

const depositStatusText: Record<string, string> = {
  pending: 'Confirming on Blockchain',
  detected: 'Detected on Chain',
  confirmed: 'Confirmed',
  credited: 'Credited',
  approved: 'Credited',
  completed: 'Confirmed',
  rejected: 'Rejected',
  declined: 'Cancelled',
  expired: 'Expired',
  awaiting_confirmation: 'Waiting for Confirmations',
};

export function CoinBadgeLogo({ coin, className = "h-5 w-5" }: { coin: string; className?: string }) {
  const norm = (coin || '').toUpperCase();
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
    case 'USDT-ERC20':
    case 'USDT-TRC20':
    case 'USDT-BEP20':
      return <UsdtLogo className={className} />;
    default:
      return <UsdtLogo className={className} />;
  }
}

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
  gasFee: number;
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
        const mapped: DisplayDeposit[] = data.map((d: any) => ({
          id: d.id,
          crypto: (d.asset_code || d.asset_symbol || d.asset || d.token_symbol || 'USDT') as CryptoCurrency,
          chain: d.network_code || d.network || d.chain || 'Mainnet',
          amount: Number(d.amount || 0),
          status: (d.status || 'confirmed').toLowerCase(),
          createdAt: d.created_at,
          walletAddress: d.deposit_address_id || d.address || d.to_address,
          txid: d.txid || d.tx_hash,
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
      <div className="space-y-3 p-2">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    );
  if (!deposits?.length) return <p className="text-center text-muted-foreground py-8 text-sm">No deposit history found.</p>;

  return (
    <div className="space-y-4">
      {/* Desktop Table View */}
      <div className="hidden md:block rounded-xl border border-blue-500/20 bg-card/60 overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-blue-500/5 dark:bg-blue-950/20">
            <TableRow className="hover:bg-transparent border-blue-500/10">
              <TableHead className="text-blue-600 dark:text-blue-400 font-semibold">Asset</TableHead>
              <TableHead className="text-blue-600 dark:text-blue-400 font-semibold">Amount</TableHead>
              <TableHead className="text-blue-600 dark:text-blue-400 font-semibold">Status</TableHead>
              <TableHead className="text-blue-600 dark:text-blue-400 font-semibold">Date & Time</TableHead>
              <TableHead className="text-blue-600 dark:text-blue-400 font-semibold">Transaction Hash</TableHead>
              <TableHead className="text-right text-blue-600 dark:text-blue-400 font-semibold">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deposits.map((d) => {
              const displayStatus = depositStatusText[d.status.toLowerCase()] || d.status;
              const dateObj = d.createdAt ? new Date(d.createdAt) : null;
              const dateStr = dateObj ? dateObj.toLocaleDateString() : 'N/A';
              const timeStr = dateObj ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
              const explorerUrl = getTxExplorerUrl(d.txid, d.chain || d.crypto);

              return (
                <TableRow 
                  key={d.id} 
                  onClick={() => onRowClick(d)} 
                  className="cursor-pointer hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition-colors border-blue-500/10"
                >
                  <TableCell className="py-3.5">
                    <div className="flex items-center gap-2.5">
                      <CoinBadgeLogo coin={d.crypto} className="h-6 w-6 shrink-0" />
                      <div>
                        <div className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                          {d.crypto}
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium">
                            {d.chain}
                          </span>
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono font-bold text-sm text-emerald-600 dark:text-emerald-400">
                    +{d.amount} {d.crypto}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn('capitalize text-xs font-medium', statusColors[d.status as keyof typeof statusColors] || 'bg-muted text-muted-foreground')}
                    >
                      {displayStatus}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="text-xs flex flex-col">
                      <span className="font-medium text-foreground">{dateStr}</span>
                      <span className="text-muted-foreground text-[11px]">{timeStr}</span>
                    </div>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {d.txid ? (
                      explorerUrl ? (
                        <a
                          href={explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 font-mono text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline bg-blue-50 dark:bg-blue-950/40 px-2 py-1 rounded-md transition"
                        >
                          <span className="max-w-[120px] truncate">{d.txid}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="font-mono text-xs text-muted-foreground max-w-[120px] truncate block">
                          {d.txid}
                        </span>
                      )
                    ) : (
                      <span className="text-xs text-muted-foreground italic">Pending</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => { e.stopPropagation(); onRowClick(d); }}>
                    <Button 
                      variant="outline" 
                      size="sm"
                      className="h-8 gap-1 border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>View</span>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile Card View */}
      <div className="grid gap-3 md:hidden">
        {deposits.map((d) => {
          const displayStatus = depositStatusText[d.status.toLowerCase()] || d.status;
          const dateObj = d.createdAt ? new Date(d.createdAt) : null;
          const dateStr = dateObj ? dateObj.toLocaleDateString() : 'N/A';
          const timeStr = dateObj ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
          const explorerUrl = getTxExplorerUrl(d.txid, d.chain || d.crypto);

          return (
            <div
              key={d.id}
              onClick={() => onRowClick(d)}
              className="p-4 rounded-xl border border-blue-500/20 bg-card hover:bg-blue-50/40 dark:hover:bg-blue-950/20 transition shadow-sm space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <CoinBadgeLogo coin={d.crypto} className="h-7 w-7 shrink-0" />
                  <div>
                    <div className="font-bold text-sm text-foreground flex items-center gap-1.5">
                      {d.crypto}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium">
                        {d.chain}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Clock className="h-3 w-3" />
                      <span>{dateStr} {timeStr}</span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono font-bold text-sm text-emerald-600 dark:text-emerald-400">
                    +{d.amount} {d.crypto}
                  </div>
                  <Badge
                    variant="outline"
                    className={cn('capitalize text-[10px] font-medium mt-1', statusColors[d.status as keyof typeof statusColors] || 'bg-muted text-muted-foreground')}
                  >
                    {displayStatus}
                  </Badge>
                </div>
              </div>

              {d.txid && (
                <div 
                  className="pt-2 border-t border-border/40 flex items-center justify-between text-xs"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-muted-foreground text-[11px]">Tx Hash:</span>
                  {explorerUrl ? (
                    <a
                      href={explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-[11px] text-blue-600 dark:text-blue-400 hover:underline max-w-[190px] truncate"
                    >
                      <span className="truncate">{d.txid}</span>
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  ) : (
                    <span className="font-mono text-[11px] text-muted-foreground max-w-[190px] truncate">
                      {d.txid}
                    </span>
                  )}
                </div>
              )}

              <div className="pt-1 flex justify-end">
                <Button 
                  variant="outline" 
                  size="sm"
                  className="w-full h-8 gap-1.5 text-xs border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50"
                  onClick={(e) => { e.stopPropagation(); onRowClick(d); }}
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>View Details</span>
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
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
        const mapped: DisplayWithdrawal[] = data.map((w: any) => ({
          id: w.id,
          crypto: (w.token_symbol || w.asset_code || w.crypto || 'ETH') as CryptoCurrency,
          chain: w.chain || w.network_code || 'Sepolia',
          amount: Number(w.amount || 0),
          gasFee: Number(w.gas_fee ?? w.fee ?? w.network_fee ?? 0),
          status: String(w.status || 'CONFIRMED').toLowerCase(),
          createdAt: w.created_at,
          address: w.to_address || w.destination_address || w.address || '',
          txid: w.tx_hash || w.txid || undefined,
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
      <div className="space-y-3 p-2">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    );
  if (!withdrawals?.length) return <p className="text-center text-muted-foreground py-8 text-sm">No withdrawal history found.</p>;

  return (
    <div className="space-y-4">
      <div className="hidden md:block rounded-xl border border-blue-500/20 bg-card/60 overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-blue-500/5 dark:bg-blue-950/20">
            <TableRow className="hover:bg-transparent border-blue-500/10">
              <TableHead className="text-blue-600 dark:text-blue-400 font-semibold">Asset</TableHead>
              <TableHead className="text-blue-600 dark:text-blue-400 font-semibold">Amount</TableHead>
              <TableHead className="text-blue-600 dark:text-blue-400 font-semibold">Status</TableHead>
              <TableHead className="text-blue-600 dark:text-blue-400 font-semibold">Date & Time</TableHead>
              <TableHead className="text-blue-600 dark:text-blue-400 font-semibold">Transaction Hash</TableHead>
              <TableHead className="text-right text-blue-600 dark:text-blue-400 font-semibold">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {withdrawals.map((w) => {
              const dateObj = w.createdAt ? new Date(w.createdAt) : null;
              const dateStr = dateObj ? dateObj.toLocaleDateString() : 'N/A';
              const timeStr = dateObj ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
              const explorerUrl = getTxExplorerUrl(w.txid, w.chain || w.crypto);

              return (
                <TableRow 
                  key={w.id} 
                  onClick={() => onRowClick(w)} 
                  className="cursor-pointer hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition-colors border-blue-500/10"
                >
                  <TableCell className="py-3.5">
                    <div className="flex items-center gap-2.5">
                      <CoinBadgeLogo coin={w.crypto} className="h-6 w-6 shrink-0" />
                      <div>
                        <div className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                          {w.crypto}
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium">
                            {w.chain}
                          </span>
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono font-bold text-sm text-amber-600 dark:text-amber-400">
                    -{w.amount} {w.crypto}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn('capitalize text-xs font-medium', statusColors[w.status as keyof typeof statusColors] || 'bg-muted text-muted-foreground')}
                    >
                      {w.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="text-xs flex flex-col">
                      <span className="font-medium text-foreground">{dateStr}</span>
                      <span className="text-muted-foreground text-[11px]">{timeStr}</span>
                    </div>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {w.txid ? (
                      explorerUrl ? (
                        <a
                          href={explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 font-mono text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline bg-blue-50 dark:bg-blue-950/40 px-2 py-1 rounded-md transition"
                        >
                          <span className="max-w-[120px] truncate">{w.txid}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="font-mono text-xs text-muted-foreground max-w-[120px] truncate block">
                          {w.txid}
                        </span>
                      )
                    ) : (
                      <span className="text-xs text-muted-foreground italic">Processing</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => { e.stopPropagation(); onRowClick(w); }}>
                    <Button 
                      variant="outline" 
                      size="sm"
                      className="h-8 gap-1 border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>View</span>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-3 md:hidden">
        {withdrawals.map((w) => {
          const dateObj = w.createdAt ? new Date(w.createdAt) : null;
          const dateStr = dateObj ? dateObj.toLocaleDateString() : 'N/A';
          const timeStr = dateObj ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
          const explorerUrl = getTxExplorerUrl(w.txid, w.chain || w.crypto);

          return (
            <div
              key={w.id}
              onClick={() => onRowClick(w)}
              className="p-4 rounded-xl border border-blue-500/20 bg-card hover:bg-blue-50/40 dark:hover:bg-blue-950/20 transition shadow-sm space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <CoinBadgeLogo coin={w.crypto} className="h-7 w-7 shrink-0" />
                  <div>
                    <div className="font-bold text-sm text-foreground flex items-center gap-1.5">
                      {w.crypto}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium">
                        {w.chain}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Clock className="h-3 w-3" />
                      <span>{dateStr} {timeStr}</span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono font-bold text-sm text-amber-600 dark:text-amber-400">
                    -{w.amount} {w.crypto}
                  </div>
                  <Badge
                    variant="outline"
                    className={cn('capitalize text-[10px] font-medium mt-1', statusColors[w.status as keyof typeof statusColors] || 'bg-muted text-muted-foreground')}
                  >
                    {w.status}
                  </Badge>
                </div>
              </div>

              {w.txid && (
                <div 
                  className="pt-2 border-t border-border/40 flex items-center justify-between text-xs"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-muted-foreground text-[11px]">Tx Hash:</span>
                  {explorerUrl ? (
                    <a
                      href={explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-[11px] text-blue-600 dark:text-blue-400 hover:underline max-w-[190px] truncate"
                    >
                      <span className="truncate">{w.txid}</span>
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  ) : (
                    <span className="font-mono text-[11px] text-muted-foreground max-w-[190px] truncate">
                      {w.txid}
                    </span>
                  )}
                </div>
              )}

              <div className="pt-1 flex justify-end">
                <Button 
                  variant="outline" 
                  size="sm"
                  className="w-full h-8 gap-1.5 text-xs border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50"
                  onClick={(e) => { e.stopPropagation(); onRowClick(w); }}
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>View Details</span>
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
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
  const [isTransferOpen, setIsTransferOpen] = useState(false);

  // Fetch real-time balances from Supabase
  const loadBalances = useCallback(async () => {
    try {
      const { data: authData } = await supabase.auth.getUser();
      const sessionRes = await supabase.auth.getSession();
      const currentUserId = user?.uid || authData?.user?.id || sessionRes.data?.session?.user?.id;
      if (!currentUserId) return;

      // 1. Direct query from wallet_assets using select('*')
      const { data: walletAssets, error } = await supabase
        .from('wallet_assets')
        .select('*')
        .eq('user_id', currentUserId);

      if (!error && walletAssets && walletAssets.length > 0) {
        const balanceMap: { [key in CryptoCurrency]?: { balance: number; lockedBalance: number } } = {
          BTC: { balance: 0, lockedBalance: 0 },
          ETH: { balance: 0, lockedBalance: 0 },
          LTC: { balance: 0, lockedBalance: 0 },
          USDT: { balance: 0, lockedBalance: 0 },
        };

        walletAssets.forEach((asset: any) => {
          const rawSym = String(asset.asset_symbol || asset.asset_code || asset.symbol || '').toUpperCase();
          const symbol = (['BTC', 'ETH', 'LTC', 'USDT'].includes(rawSym) ? rawSym : null) as CryptoCurrency | null;
          const spendable = Number(asset.available ?? asset.balance ?? asset.amount ?? 0);
          const locked = Number(asset.locked ?? asset.locked_balance ?? asset.locked_escrow ?? 0) + Number(asset.locked_withdrawal ?? 0);

          if (symbol) {
            balanceMap[symbol] = {
              balance: isNaN(spendable) ? 0 : spendable,
              lockedBalance: isNaN(locked) ? 0 : locked,
            };
          }
        });

        setSupabaseBalances(balanceMap);
        return;
      }

      // 2. Fallback to getUserWalletBalances helper
      const fallbackBalances = await getUserWalletBalances(currentUserId);
      if (fallbackBalances && Object.keys(fallbackBalances).length > 0) {
        setSupabaseBalances(fallbackBalances);
      }
    } catch (err) {
      console.error('Could not load real-time wallet balances:', err);
    }
  }, [user?.uid]);

  useEffect(() => {
    loadBalances();

    const currentUserId = user?.uid;

    // 1. Subscribe to changes on wallet_assets for this specific user
    const channel = supabase
      .channel(`realtime_wallet_assets_${currentUserId || 'all'}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'wallet_assets',
          ...(currentUserId ? { filter: `user_id=eq.${currentUserId}` } : {}),
        },
        (payload: any) => {
          console.log('⚡ Realtime Balance Update Received:', payload.new || payload);

          // 2. Reactively update state with new available/locked values
          if (payload.new && payload.new.asset_symbol) {
            const sym = String(payload.new.asset_symbol).toUpperCase() as CryptoCurrency;
            const avail = Number(payload.new.available ?? 0);
            const lock = Number(payload.new.locked ?? 0);

            setSupabaseBalances((prev) => ({
              ...prev,
              [sym]: { balance: avail, lockedBalance: lock },
            }));
          } else {
            loadBalances();
          }
        }
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_wallets' }, () => loadBalances())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deposits' }, () => loadBalances())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wallet_transactions' }, () => loadBalances())
      .subscribe((status) => {
        console.log('Realtime Channel Status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadBalances, user?.uid]);

  const { balances: reactiveBalances, totalConvertedValue, preferredCurrency: walletCurrency, refreshBalances } = useWallet();

  // Aggregate summary from reactive wallet state
  const walletSummary = useMemo(() => {
    return SUPPORTED_CRYPTOS.map((crypto) => {
      const coin = crypto.name;
      const walletData = reactiveBalances?.[coin] || { available: 0, inEscrow: 0, inWithdrawal: 0, fiatValue: 0 };

      return {
        coin,
        availableBalance: walletData.available,
        inEscrow: walletData.inEscrow,
        inWithdrawal: walletData.inWithdrawal,
        fiatValue: walletData.fiatValue,
      };
    }).sort((a, b) => b.fiatValue - a.fiatValue);
  }, [reactiveBalances]);

  const totalAvailableValue = totalConvertedValue;

  const handleDepositClick = (coin: CryptoCurrency) => {
    setActiveDialogAsset(coin);
    setIsDepositOpen(true);
  };

  const handleWithdrawClick = (coin: CryptoCurrency) => {
    setActiveDialogAsset(coin);
    setIsWithdrawOpen(true);
  };

  const handleTransferClick = (coin: CryptoCurrency) => {
    setActiveDialogAsset(coin);
    setIsTransferOpen(true);
  };

  const handleHistoryRowClick = (tx: DisplayDeposit | DisplayWithdrawal) => {
    setSelectedTx(tx);
    setIsDetailsOpen(true);
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
  if (reactiveBalances) {
    for (const [key, val] of Object.entries(reactiveBalances)) {
      userWalletsFormatted[key] = { balance: val?.available || 0, address: '' };
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
      <TransferDialog
        open={isTransferOpen}
        onOpenChange={(isOpen) => {
          setIsTransferOpen(isOpen);
          if (!isOpen) setActiveDialogAsset(null);
        }}
        asset={activeDialogAsset}
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
                <div className="text-3xl font-bold">
                  {data.availableBalance === 0 ? '0' : data.availableBalance.toFixed(6)}
                </div>
                <p className="text-xs text-muted-foreground">
                  ≈{' '}
                  {data.fiatValue.toLocaleString(undefined, {
                    style: 'currency',
                    currency: profile?.preferredCurrency || 'USD',
                  })}
                </p>
              </div>
              <div className="space-y-1 pt-1 border-t border-border/40">
                {data.inEscrow > 0 && (
                  <p className="text-[11px] text-amber-500 font-medium font-mono flex items-center justify-between">
                    <span>In P2P Escrow:</span>
                    <span>{data.inEscrow === 0 ? '0' : data.inEscrow.toFixed(6)}</span>
                  </p>
                )}
                {data.inWithdrawal > 0 && (
                  <p className="text-[11px] text-blue-400 font-medium font-mono flex items-center justify-between">
                    <span>Pending Withdrawal:</span>
                    <span>{data.inWithdrawal === 0 ? '0' : data.inWithdrawal.toFixed(6)}</span>
                  </p>
                )}
                {data.inEscrow === 0 && data.inWithdrawal === 0 && (
                  <p className="text-[11px] text-muted-foreground font-mono">
                    All funds spendable
                  </p>
                )}
              </div>
            </CardContent>
            <CardFooter className="grid grid-cols-3 gap-1.5 pt-2">
              <Button size="sm" variant="default" className="px-2" onClick={() => handleDepositClick(data.coin as CryptoCurrency)}>
                <ArrowDown className="mr-1 h-3.5 w-3.5" />
                Deposit
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="px-2 border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10"
                onClick={() => handleTransferClick(data.coin as CryptoCurrency)}
              >
                <Send className="mr-1 h-3.5 w-3.5" />
                Transfer
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="px-2"
                onClick={() => handleWithdrawClick(data.coin as CryptoCurrency)}
              >
                <ArrowUp className="mr-1 h-3.5 w-3.5" />
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
              <TransferHistoryList userId={user.uid} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="max-w-md border border-blue-500/20 bg-background/95 backdrop-blur-sm shadow-xl">
          <DialogHeader>
            <div className="flex items-center gap-3">
              {selectedTx && (
                <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 shrink-0">
                  <CoinBadgeLogo coin={selectedTx.crypto || (selectedTx as any).asset || 'USDT'} className="h-6 w-6" />
                </div>
              )}
              <div>
                <DialogTitle className="text-lg font-bold text-foreground">
                  {'walletAddress' in (selectedTx || {}) ? 'Deposit Details' : 'Withdrawal Details'}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  {selectedTx && (selectedTx.crypto || (selectedTx as any).asset || 'Crypto')} on {selectedTx?.chain || 'Mainnet'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {selectedTx && (
            <div className="space-y-3.5 text-sm divide-y divide-border/50 py-1">
              {/* Amount */}
              <div className="flex justify-between items-center pt-2">
                <span className="text-xs font-medium text-muted-foreground">Amount:</span>
                <span className="font-mono font-bold text-base text-emerald-600 dark:text-emerald-400">
                  {'walletAddress' in selectedTx ? '+' : '-'}{selectedTx.amount} {selectedTx.crypto || (selectedTx as any).asset || 'USDT'}
                </span>
              </div>

              {/* Status */}
              <div className="flex justify-between items-center pt-3">
                <span className="text-xs font-medium text-muted-foreground">Status:</span>
                <Badge
                  variant="outline"
                  className={cn('capitalize text-xs font-medium', statusColors[selectedTx.status as keyof typeof statusColors] || 'bg-muted text-muted-foreground')}
                >
                  {depositStatusText[selectedTx.status.toLowerCase()] || selectedTx.status}
                </Badge>
              </div>

              {/* Date & Time */}
              <div className="flex justify-between items-center pt-3">
                <span className="text-xs font-medium text-muted-foreground">Date & Time:</span>
                <span className="text-xs font-medium text-foreground">
                  {selectedTx.createdAt ? new Date(selectedTx.createdAt).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'medium',
                  }) : 'N/A'}
                </span>
              </div>

              {/* Network / Chain */}
              <div className="flex justify-between items-center pt-3">
                <span className="text-xs font-medium text-muted-foreground">Network / Chain:</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  {selectedTx.chain || 'Mainnet'}
                </span>
              </div>

              {/* Destination / Deposit Address */}
              <div className="flex flex-col gap-1.5 pt-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-medium text-muted-foreground">
                    {'walletAddress' in selectedTx ? 'Deposit Address:' : 'Destination Address:'}
                  </span>
                  {('walletAddress' in selectedTx ? selectedTx.walletAddress : (selectedTx as DisplayWithdrawal).address) && (
                    (() => {
                      const addr = 'walletAddress' in selectedTx ? selectedTx.walletAddress : (selectedTx as DisplayWithdrawal).address;
                      const addrExpUrl = getAddressExplorerUrl(addr, selectedTx.chain || selectedTx.crypto);
                      return addrExpUrl ? (
                        <a
                          href={addrExpUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                        >
                          <span>Explorer</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null;
                    })()
                  )}
                </div>
                <div className="p-2.5 rounded-lg bg-muted/50 border border-border/60 font-mono text-xs break-all text-foreground select-all">
                  {'walletAddress' in selectedTx
                    ? selectedTx.walletAddress || 'N/A'
                    : (selectedTx as DisplayWithdrawal).address || 'N/A'}
                </div>
              </div>

              {/* Gas Fee / Network Fee - ONLY shown for withdrawals */}
              {'gasFee' in selectedTx && (
                <div className="flex justify-between items-center pt-3">
                  <span className="text-xs font-medium text-muted-foreground">Gas / Network Fee:</span>
                  <span className="font-mono text-xs font-semibold text-foreground px-2 py-0.5 rounded bg-muted">
                    {(selectedTx as DisplayWithdrawal).gasFee} {selectedTx.crypto}
                  </span>
                </div>
              )}

              {/* Transaction Hash */}
              {selectedTx.txid && (
                <div className="flex flex-col gap-1.5 pt-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-medium text-muted-foreground">Transaction Hash (TxID):</span>
                    {(() => {
                      const expUrl = getTxExplorerUrl(selectedTx.txid, selectedTx.chain || selectedTx.crypto);
                      return expUrl ? (
                        <a
                          href={expUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline flex items-center gap-1 font-semibold"
                        >
                          <span>View on Explorer</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null;
                    })()}
                  </div>
                  <div className="p-2.5 rounded-lg bg-blue-50/50 dark:bg-blue-950/30 border border-blue-500/20 font-mono text-xs break-all text-blue-700 dark:text-blue-300 select-all">
                    {selectedTx.txid}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mt-5 flex gap-2">
            {selectedTx?.txid && getTxExplorerUrl(selectedTx.txid, selectedTx.chain || selectedTx.crypto) && (
              <Button
                asChild
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white gap-1.5 text-xs h-9"
              >
                <a
                  href={getTxExplorerUrl(selectedTx.txid, selectedTx.chain || selectedTx.crypto)!}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Open in Explorer</span>
                </a>
              </Button>
            )}
            <Button
              variant="outline"
              className={cn(
                "h-9 text-xs border-border/80",
                selectedTx?.txid && getTxExplorerUrl(selectedTx.txid, selectedTx.chain || selectedTx.crypto) ? "w-28" : "w-full"
              )}
              onClick={() => setIsDetailsOpen(false)}
            >
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
