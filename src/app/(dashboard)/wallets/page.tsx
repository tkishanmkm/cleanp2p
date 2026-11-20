'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import { useI18n } from '@/context/i18n-context';
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
import { CoinBadgeLogo } from '@/components/wallets/coin-badge-logo';
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

type WalletRecordKind = 'deposit' | 'withdrawal';

const depositStatusTranslationKeys: Record<string, string> = {
  pending: 'confirmingOnBlockchain',
  confirming: 'confirmingOnBlockchain',
  confirming_on_chain: 'confirmingOnBlockchain',
  confirming_on_blockchain: 'confirmingOnBlockchain',
  detecting: 'detectedOnChain',
  detected: 'detectedOnChain',
  seen: 'detectedOnChain',
  seen_on_chain: 'detectedOnChain',
  confirmed: 'confirmed',
  credited: 'credited',
  approved: 'credited',
  completed: 'confirmed',
  rejected: 'rejected',
  declined: 'common.cancelled',
  cancelled: 'common.cancelled',
  canceled: 'common.cancelled',
  expired: 'common.expired',
  awaiting_confirmation: 'waitingForConfirmations',
  awaiting_confirmations: 'waitingForConfirmations',
  waiting_for_confirmations: 'waitingForConfirmations',
  processing: 'processing',
  queued: 'processing',
  failed: 'statusFailed',
  error: 'statusFailed',
  refunded: 'statusRefunded',
};

const withdrawalStatusTranslationKeys: Record<string, string> = {
  pending: 'statusPending',
  processing: 'processing',
  queued: 'processing',
  broadcasting: 'statusBroadcasting',
  broadcast: 'statusBroadcasting',
  broadcasted: 'statusBroadcasted',
  submitted: 'statusBroadcasted',
  sent: 'statusBroadcasted',
  confirmed: 'confirmed',
  completed: 'common.completed',
  success: 'common.completed',
  credited: 'credited',
  approved: 'common.completed',
  failed: 'statusFailed',
  error: 'statusFailed',
  rejected: 'rejected',
  declined: 'common.cancelled',
  cancelled: 'common.cancelled',
  canceled: 'common.cancelled',
  expired: 'common.expired',
  refunded: 'statusRefunded',
  requested: 'statusRequested',
  awaiting_approval: 'statusAwaitingApproval',
  awaiting_review: 'statusAwaitingApproval',
};

function walletStatusLabel(
  status: string,
  t: (key: string) => string,
  kind: WalletRecordKind = 'deposit'
): string {
  const normalized = String(status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const translationKey = (kind === 'deposit' ? depositStatusTranslationKeys : withdrawalStatusTranslationKeys)[normalized];
  if (!translationKey) return status || t('walletPage.notAvailable');
  return translationKey.startsWith('common.')
    ? t(translationKey)
    : t('walletPage.' + translationKey);
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
  const { t, language } = useI18n();
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
  if (!deposits?.length) return <p className="text-center text-muted-foreground py-8 text-sm">{t('walletPage.noDepositHistory')}</p>;

  return (
    <div className="space-y-4">
      {/* Desktop Table View */}
      <div className="hidden md:block rounded-xl border border-blue-500/20 bg-card/60 overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-blue-500/5 dark:bg-blue-950/20">
            <TableRow className="hover:bg-transparent border-blue-500/10">
              <TableHead className="text-blue-600 dark:text-blue-400 font-semibold">{t('walletPage.asset')}</TableHead>
              <TableHead className="text-blue-600 dark:text-blue-400 font-semibold">{t('common.amount')}</TableHead>
              <TableHead className="text-blue-600 dark:text-blue-400 font-semibold">{t('common.status')}</TableHead>
              <TableHead className="text-blue-600 dark:text-blue-400 font-semibold">{t('walletPage.dateTime')}</TableHead>
              <TableHead className="text-blue-600 dark:text-blue-400 font-semibold">{t('walletPage.transactionHash')}</TableHead>
              <TableHead className="text-right text-blue-600 dark:text-blue-400 font-semibold">{t('walletPage.action')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deposits.map((d) => {
              const displayStatus = walletStatusLabel(d.status, t, 'deposit');
              const dateObj = d.createdAt ? new Date(d.createdAt) : null;
              const dateStr = dateObj ? dateObj.toLocaleDateString(language) : t('walletPage.notAvailable');
              const timeStr = dateObj ? dateObj.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
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
                      <span className="text-xs text-muted-foreground italic">{t('common.pending')}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => { e.stopPropagation(); onRowClick(d); }}>
                    <Button 
                      variant="outline" 
                      size="sm"
                      className="h-8 gap-1 border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>{t('walletPage.view')}</span>
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
          const displayStatus = walletStatusLabel(d.status, t, 'deposit');
          const dateObj = d.createdAt ? new Date(d.createdAt) : null;
          const dateStr = dateObj ? dateObj.toLocaleDateString(language) : t('walletPage.notAvailable');
          const timeStr = dateObj ? dateObj.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' }) : '';
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
                  <span className="text-muted-foreground text-[11px]">{t('walletPage.transactionHash')}:</span>
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
                  <span>{t('walletPage.viewDetails')}</span>
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
  const { t, language } = useI18n();
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
          chain: w.chain || w.network_code || 'ERC20',
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
  if (!withdrawals?.length) return <p className="text-center text-muted-foreground py-8 text-sm">{t('walletPage.noWithdrawalHistory')}</p>;

  return (
    <div className="space-y-4">
      <div className="hidden md:block rounded-xl border border-blue-500/20 bg-card/60 overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-blue-500/5 dark:bg-blue-950/20">
            <TableRow className="hover:bg-transparent border-blue-500/10">
              <TableHead className="text-blue-600 dark:text-blue-400 font-semibold">{t('walletPage.asset')}</TableHead>
              <TableHead className="text-blue-600 dark:text-blue-400 font-semibold">{t('common.amount')}</TableHead>
              <TableHead className="text-blue-600 dark:text-blue-400 font-semibold">{t('common.status')}</TableHead>
              <TableHead className="text-blue-600 dark:text-blue-400 font-semibold">{t('walletPage.dateTime')}</TableHead>
              <TableHead className="text-blue-600 dark:text-blue-400 font-semibold">{t('walletPage.transactionHash')}</TableHead>
              <TableHead className="text-right text-blue-600 dark:text-blue-400 font-semibold">{t('walletPage.action')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {withdrawals.map((w) => {
              const dateObj = w.createdAt ? new Date(w.createdAt) : null;
              const dateStr = dateObj ? dateObj.toLocaleDateString(language) : t('walletPage.notAvailable');
              const timeStr = dateObj ? dateObj.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
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
                      {walletStatusLabel(w.status, t, 'withdrawal')}
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
                      <span className="text-xs text-muted-foreground italic">{t('walletPage.processing')}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => { e.stopPropagation(); onRowClick(w); }}>
                    <Button 
                      variant="outline" 
                      size="sm"
                      className="h-8 gap-1 border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>{t('walletPage.view')}</span>
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
          const dateStr = dateObj ? dateObj.toLocaleDateString(language) : t('walletPage.notAvailable');
          const timeStr = dateObj ? dateObj.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' }) : '';
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
                    {walletStatusLabel(w.status, t, 'withdrawal')}
                  </Badge>
                </div>
              </div>

              {w.txid && (
                <div 
                  className="pt-2 border-t border-border/40 flex items-center justify-between text-xs"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-muted-foreground text-[11px]">{t('walletPage.transactionHash')}:</span>
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
                  <span>{t('walletPage.viewDetails')}</span>
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
  const { t, language } = useI18n();
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

  // Fetch real-time balances with accurate escrow locks
  const loadBalances = useCallback(async () => {
    try {
      const { data: authData } = await supabase.auth.getUser();
      const sessionRes = await supabase.auth.getSession();
      const currentUserId = user?.uid || authData?.user?.id || sessionRes.data?.session?.user?.id;
      if (!currentUserId) {
        setSupabaseBalances(null);
        return;
      }

      // The shared helper uses only the canonical authenticated balance API.
      // It never reads legacy balance tables when the canonical API is unavailable.
      const balances = await getUserWalletBalances(currentUserId);
      setSupabaseBalances(balances);
    } catch (error: unknown) {
      console.error(
        '[WalletPage] Canonical wallet balance load failed:',
        error instanceof Error ? error.name : 'UnknownError'
      );
      setSupabaseBalances(null);
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

          // Re-read the canonical API after every commit. Realtime payloads are
          // not a substitute for the server's reserve/escrow bucket validation.
          loadBalances();
        }
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_wallets' }, () => loadBalances())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trades' }, () => loadBalances())
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
        <h1 className="text-lg font-semibold md:text-2xl">{t('walletPage.walletPageTitle')}</h1>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">{t('walletPage.totalAvailableValue')}</p>
          <p className="text-xl font-bold">
            {totalAvailableValue.toLocaleString(language, {
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
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider block">{t('wallet.availableBalance')}</span>
                <div className="text-3xl font-bold mt-1">
                  {data.availableBalance === 0 ? '0' : data.availableBalance.toFixed(6)}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  ≈{' '}
                  {data.fiatValue.toLocaleString(language, {
                    style: 'currency',
                    currency: profile?.preferredCurrency || 'USD',
                  })}
                </p>
              </div>
            </CardContent>
            <CardFooter className="grid grid-cols-3 gap-1.5 pt-2">
              <Button size="sm" variant="default" className="px-2" onClick={() => handleDepositClick(data.coin as CryptoCurrency)}>
                <ArrowDown className="mr-1 h-3.5 w-3.5" />
                {t('wallet.deposit')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="px-2 border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10"
                onClick={() => handleTransferClick(data.coin as CryptoCurrency)}
              >
                <Send className="mr-1 h-3.5 w-3.5" />
                {t('walletPage.transferAction')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="px-2"
                onClick={() => handleWithdrawClick(data.coin as CryptoCurrency)}
              >
                <ArrowUp className="mr-1 h-3.5 w-3.5" />
                {t('wallet.withdraw')}
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('walletPage.transactionHistory')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="deposits">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="deposits">{t('walletPage.deposits')}</TabsTrigger>
              <TabsTrigger value="withdrawals">{t('walletPage.withdrawals')}</TabsTrigger>
              <TabsTrigger value="transfers">{t('walletPage.transfers')}</TabsTrigger>
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
                  {'walletAddress' in (selectedTx || {}) ? t('walletPage.depositDetails') : t('walletPage.withdrawalDetails')}
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
                <span className="text-xs font-medium text-muted-foreground">{t('common.amount')}:</span>
                <span className="font-mono font-bold text-base text-emerald-600 dark:text-emerald-400">
                  {'walletAddress' in selectedTx ? '+' : '-'}{selectedTx.amount} {selectedTx.crypto || (selectedTx as any).asset || 'USDT'}
                </span>
              </div>

              {/* Status */}
              <div className="flex justify-between items-center pt-3">
                <span className="text-xs font-medium text-muted-foreground">{t('common.status')}:</span>
                <Badge
                  variant="outline"
                  className={cn('capitalize text-xs font-medium', statusColors[selectedTx.status as keyof typeof statusColors] || 'bg-muted text-muted-foreground')}
                >
                  {walletStatusLabel(selectedTx.status, t, 'walletAddress' in selectedTx ? 'deposit' : 'withdrawal')}
                </Badge>
              </div>

              {/* Date & Time */}
              <div className="flex justify-between items-center pt-3">
                <span className="text-xs font-medium text-muted-foreground">{t('walletPage.dateTime')}:</span>
                <span className="text-xs font-medium text-foreground">
                  {selectedTx.createdAt ? new Date(selectedTx.createdAt).toLocaleString(language, {
                    dateStyle: 'medium',
                    timeStyle: 'medium',
                  }) : t('walletPage.notAvailable')}
                </span>
              </div>

              {/* Network / Chain */}
              <div className="flex justify-between items-center pt-3">
                <span className="text-xs font-medium text-muted-foreground">{t('walletPage.networkChain')}:</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  {selectedTx.chain || 'Mainnet'}
                </span>
              </div>

              {/* Destination / Deposit Address */}
              <div className="flex flex-col gap-1.5 pt-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-medium text-muted-foreground">
                    {'walletAddress' in selectedTx ? t('walletPage.depositAddress') + ':' : t('walletPage.destinationAddress') + ':'}
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
                          <span>{t('walletPage.explorer')}</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null;
                    })()
                  )}
                </div>
                <div className="p-2.5 rounded-lg bg-muted/50 border border-border/60 font-mono text-xs break-all text-foreground select-all">
                  {'walletAddress' in selectedTx
                    ? selectedTx.walletAddress || t('walletPage.notAvailable')
                    : (selectedTx as DisplayWithdrawal).address || t('walletPage.notAvailable')}
                </div>
              </div>

              {/* Gas Fee / Network Fee - ONLY shown for withdrawals */}
              {'gasFee' in selectedTx && (
                <div className="flex justify-between items-center pt-3">
                  <span className="text-xs font-medium text-muted-foreground">{t('walletPage.gasNetworkFee')}:</span>
                  <span className="font-mono text-xs font-semibold text-foreground px-2 py-0.5 rounded bg-muted">
                    {(selectedTx as DisplayWithdrawal).gasFee} {selectedTx.crypto}
                  </span>
                </div>
              )}

              {/* Transaction Hash */}
              {selectedTx.txid && (
                <div className="flex flex-col gap-1.5 pt-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-medium text-muted-foreground">{t('wallet.txHash')}:</span>
                    {(() => {
                      const expUrl = getTxExplorerUrl(selectedTx.txid, selectedTx.chain || selectedTx.crypto);
                      return expUrl ? (
                        <a
                          href={expUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline flex items-center gap-1 font-semibold"
                        >
                          <span>{t('walletPage.viewOnExplorer')}</span>
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
                  <span>{t('walletPage.openInExplorer')}</span>
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
              {t('walletPage.close')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
