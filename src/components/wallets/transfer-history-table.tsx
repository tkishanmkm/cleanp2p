'use client';

import { useState, useEffect, useCallback } from 'react';
import type { CryptoCurrency } from '@/lib/types';
import { useI18n } from '@/context/i18n-context';
import { supabase } from '@/lib/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { statusColors } from '@/lib/status-colors';
import { cn } from '@/lib/utils';
import { ArrowUpRight, ArrowDownLeft, Eye, Clock, User as UserIcon, Copy, Check } from 'lucide-react';
import { BtcLogo, EthLogo, LtcLogo, UsdtLogo } from '@/components/icons';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

function CoinBadgeLogo({ coin, className = 'h-5 w-5' }: { coin: string; className?: string }) {
  switch (coin?.toUpperCase()) {
    case 'BTC':
      return <BtcLogo className={className} />;
    case 'ETH':
      return <EthLogo className={className} />;
    case 'LTC':
      return <LtcLogo className={className} />;
    case 'USDT':
      return <UsdtLogo className={className} />;
    default:
      return <UsdtLogo className={className} />;
  }
}

const transferStatusTranslationKeys: Record<string, string> = {
  completed: 'statusCompleted', complete: 'statusCompleted', successful: 'statusCompleted', success: 'statusCompleted', confirmed: 'statusCompleted', settled: 'statusCompleted',
  pending: 'statusPending', queued: 'statusPending', created: 'statusPending', initiated: 'statusPending',
  processing: 'statusProcessing', in_progress: 'statusProcessing',
  failed: 'statusFailed', error: 'statusFailed',
  cancelled: 'statusCancelled', canceled: 'statusCancelled',
  rejected: 'statusRejected', refunded: 'statusRefunded', reversed: 'statusRefunded',
};

function transferStatusLabel(status: string, translate: (key: string) => string): string {
  const normalized = String(status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const key = transferStatusTranslationKeys[normalized];
  return key ? translate('transferHistory.' + key) : (status || translate('transferHistory.statusUnknown'));
}

function formatTransferUsername(username: string, translate: (key: string) => string): string {
  if (!username) return translate('transferHistory.trader');
  if (username === translate('transferHistory.you') || username === translate('transferHistory.trader')) return username;
  return '@' + username;
}

// Generate a consistent 12-character alphanumeric transfer ID
export function formatTransferId(rawId: string | undefined | null, createdAt?: string | Date | null): string {
  if (!rawId) return 'TRF' + Math.random().toString(36).substring(2, 11).toUpperCase();
  
  // Clean alphanumeric only
  const clean = rawId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (clean.length >= 12) {
    return clean.substring(0, 12);
  }
  
  // Deterministic 12-char fallback
  const pad = 'TX' + clean + (createdAt ? new Date(createdAt).getTime().toString(36).toUpperCase() : '00000000');
  return pad.substring(0, 12);
}

export interface DisplayTransfer {
  id: string;
  transferId: string;
  senderId: string;
  senderUsername: string;
  recipientId: string;
  recipientUsername: string;
  crypto: CryptoCurrency;
  amount: number;
  fee: number;
  status: string;
  createdAt: string | Date | null;
  isSent: boolean;
}

interface TransferHistoryListProps {
  userId: string;
  type?: 'all' | 'sent' | 'received';
  onRowClick?: (transfer: any) => void;
}

export function TransferHistoryList({ userId, type = 'all', onRowClick }: TransferHistoryListProps) {
  const { t: translate, language } = useI18n();
  const [allTransfers, setAllTransfers] = useState<DisplayTransfer[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTransfer, setSelectedTransfer] = useState<DisplayTransfer | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const fetchTransfers = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    try {
      // 1. Try fetching from server-side history endpoint (bypasses RLS)
      try {
        const res = await fetch('/api/wallet/history/transfers?limit=50');
        if (res.ok) {
          const json = await res.json();
          if (json?.data && Array.isArray(json.data) && json.data.length > 0) {
            const mapped: DisplayTransfer[] = json.data.map((t: any) => {
              const isSent = t.type === 'SENT' || t.sender_id === userId;
              const formattedId = formatTransferId(t.public_id || t.transferId || t.id, t.created_at);
              const resolvedSender = isSent
                ? translate('transferHistory.you')
                : (t.sender_username && !t.sender_username.startsWith('User_') && t.sender_username !== 'Trader'
                  ? t.sender_username
                  : translate('transferHistory.trader'));
              const resolvedRecipient = !isSent
                ? translate('transferHistory.you')
                : (t.recipient_username && !t.recipient_username.startsWith('User_') && t.recipient_username !== 'Trader'
                  ? t.recipient_username
                  : translate('transferHistory.trader'));

              return {
                id: t.id,
                transferId: formattedId,
                senderId: t.sender_id,
                senderUsername: resolvedSender,
                recipientId: t.recipient_id,
                recipientUsername: resolvedRecipient,
                crypto: (t.crypto || t.asset_symbol || 'USDT') as CryptoCurrency,
                amount: Number(t.amount || 0),
                fee: Number(t.fee != null ? t.fee : (t.fee_amount != null ? t.fee_amount : (Number(t.amount || 0) * 0.015).toFixed(8))),
                status: (t.status || 'completed').toLowerCase(),
                createdAt: t.created_at,
                isSent,
              };
            });
            setAllTransfers(mapped);
            setIsLoading(false);
            return;
          }
        }
      } catch (apiErr) {
        console.warn('API history fetch notice, falling back to direct Supabase query:', apiErr);
      }

      // 2. Direct query fallback
      const { data, error } = await supabase
        .from('transfers')
        .select('*')
        .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Extract unique user IDs to fetch profiles for usernames if needed
      const userIdsToFetch = new Set<string>();
      (data || []).forEach((t: any) => {
        if (t.sender_id) userIdsToFetch.add(t.sender_id);
        if (t.recipient_id) userIdsToFetch.add(t.recipient_id);
      });

      let profileMap: Record<string, string> = {};
      if (userIdsToFetch.size > 0) {
        try {
          const { data: profs } = await supabase
            .from('public_profiles')
            .select('id, username')
            .in('id', Array.from(userIdsToFetch));
          
          if (profs) {
            profs.forEach((p: any) => {
              if (p.id && p.username) profileMap[p.id] = p.username;
            });
          }
        } catch (e) {
          console.warn('Could not fetch profiles map for transfers:', e);
        }
      }

      const mapped: DisplayTransfer[] = (data || []).map((t: any) => {
        const isSent = t.sender_id === userId;
        const formattedId = formatTransferId(t.public_id || t.transfer_id || t.id, t.created_at);
        const resolvedSender = isSent
          ? translate('transferHistory.you')
          : (profileMap[t.sender_id] || (t.sender_username && !t.sender_username.startsWith('User_') && t.sender_username !== 'Trader' ? t.sender_username : translate('transferHistory.trader')));
        const resolvedRecipient = !isSent
          ? translate('transferHistory.you')
          : (profileMap[t.recipient_id] || (t.recipient_username && !t.recipient_username.startsWith('User_') && t.recipient_username !== 'Trader' ? t.recipient_username : translate('transferHistory.trader')));
        
        return {
          id: t.id,
          transferId: formattedId,
          senderId: t.sender_id,
          senderUsername: resolvedSender,
          recipientId: t.recipient_id,
          recipientUsername: resolvedRecipient,
          crypto: (t.crypto || t.asset_symbol || t.coin || 'USDT') as CryptoCurrency,
          amount: Number(t.amount || 0),
          fee: Number(t.fee != null ? t.fee : (t.fee_amount != null ? t.fee_amount : (Number(t.amount || 0) * 0.015).toFixed(8))),
          status: (t.status || 'completed').toLowerCase(),
          createdAt: t.created_at,
          isSent,
        };
      });

      setAllTransfers(mapped);
    } catch (err) {
      console.warn('Could not fetch Supabase transfers:', err);
      setAllTransfers([]);
    } finally {
      setIsLoading(false);
    }
  }, [userId, translate]);

  const transfers = (allTransfers || []).filter((t) => {
    if (type === 'sent') return t.isSent;
    if (type === 'received') return !t.isSent;
    return true;
  });

  useEffect(() => {
    fetchTransfers();
  }, [fetchTransfers]);

  const handleRowSelect = (t: DisplayTransfer) => {
    if (onRowClick) {
      onRowClick(t);
    }
    setSelectedTransfer(t);
    setIsDialogOpen(true);
  };

  const copyToClipboard = (text: string, field: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3 p-2">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    );
  }

  if (!transfers || transfers.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-8 text-sm">
        {translate('transferHistory.empty')}
      </p>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {/* Desktop Table View */}
        <div className="hidden md:block rounded-xl border border-blue-500/20 bg-card/60 overflow-hidden shadow-sm">
          <Table>
            <TableHeader className="bg-blue-500/5 dark:bg-blue-950/20">
              <TableRow className="hover:bg-transparent border-blue-500/10">
                <TableHead className="text-blue-600 dark:text-blue-400 font-semibold">{translate('transferHistory.asset')}</TableHead>
                <TableHead className="text-blue-600 dark:text-blue-400 font-semibold">{translate('transferHistory.transferId')}</TableHead>
                <TableHead className="text-blue-600 dark:text-blue-400 font-semibold">{translate('transferHistory.recipientSender')}</TableHead>
                <TableHead className="text-blue-600 dark:text-blue-400 font-semibold">{translate('transferHistory.amount')}</TableHead>
                <TableHead className="text-blue-600 dark:text-blue-400 font-semibold">{translate('transferHistory.status')}</TableHead>
                <TableHead className="text-blue-600 dark:text-blue-400 font-semibold">{translate('transferHistory.dateTime')}</TableHead>
                <TableHead className="text-right text-blue-600 dark:text-blue-400 font-semibold">{translate('transferHistory.action')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transfers.map((t) => {
                const dateObj = t.createdAt ? new Date(t.createdAt) : null;
                const dateStr = dateObj ? dateObj.toLocaleDateString(language) : translate('transferHistory.notAvailable');
                const timeStr = dateObj ? dateObj.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

                return (
                  <TableRow
                    key={t.id}
                    onClick={() => handleRowSelect(t)}
                    className="cursor-pointer hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition-colors border-blue-500/10"
                  >
                    <TableCell className="py-3.5">
                      <div className="flex items-center gap-2.5">
                        <CoinBadgeLogo coin={t.crypto} className="h-6 w-6 shrink-0" />
                        <div>
                          <div className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                            {t.crypto}
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium">
                              {translate('transferHistory.internal')}
                            </span>
                          </div>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell>
                      <span className="font-mono text-xs font-semibold px-2 py-1 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 tracking-wider">
                        {t.transferId}
                      </span>
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center gap-1.5 text-sm">
                        {t.isSent ? (
                          <>
                            <ArrowUpRight className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                            <span className="text-xs text-muted-foreground">{translate('transferHistory.to')}</span>
                            <span className="font-medium text-foreground">{formatTransferUsername(t.recipientUsername, translate)}</span>
                          </>
                        ) : (
                          <>
                            <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                            <span className="text-xs text-muted-foreground">{translate('transferHistory.from')}</span>
                            <span className="font-medium text-foreground">{formatTransferUsername(t.senderUsername, translate)}</span>
                          </>
                        )}
                      </div>
                    </TableCell>

                    <TableCell>
                      <span className={cn(
                        'font-mono font-bold text-sm',
                        t.isSent ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
                      )}>
                        {t.isSent ? '-' : '+'}{t.amount} {t.crypto}
                      </span>
                    </TableCell>

                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn('capitalize text-xs font-medium', statusColors[t.status as keyof typeof statusColors] || 'bg-muted text-muted-foreground')}
                      >
                        {transferStatusLabel(t.status, translate)}
                      </Badge>
                    </TableCell>

                    <TableCell>
                      <div className="text-xs flex flex-col">
                        <span className="font-medium text-foreground">{dateStr}</span>
                        <span className="text-muted-foreground text-[11px]">{timeStr}</span>
                      </div>
                    </TableCell>

                    <TableCell className="text-right" onClick={(e) => { e.stopPropagation(); handleRowSelect(t); }}>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1 border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>{translate('transferHistory.view')}</span>
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
          {transfers.map((t) => {
            const dateObj = t.createdAt ? new Date(t.createdAt) : null;
            const dateStr = dateObj ? dateObj.toLocaleDateString(language) : translate('transferHistory.notAvailable');
            const timeStr = dateObj ? dateObj.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' }) : '';

            return (
              <div
                key={t.id}
                onClick={() => handleRowSelect(t)}
                className="p-4 rounded-xl border border-blue-500/20 bg-card hover:bg-blue-50/40 dark:hover:bg-blue-950/20 transition shadow-sm space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <CoinBadgeLogo coin={t.crypto} className="h-7 w-7 shrink-0" />
                    <div>
                      <div className="font-bold text-sm text-foreground flex items-center gap-1.5">
                        {t.crypto}
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium">
                          {translate('transferHistory.internal')}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Clock className="h-3 w-3" />
                        <span>{dateStr} {timeStr}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={cn(
                      'font-mono font-bold text-sm',
                      t.isSent ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
                    )}>
                      {t.isSent ? '-' : '+'}{t.amount} {t.crypto}
                    </div>
                    <Badge
                      variant="outline"
                      className={cn('capitalize text-[10px] font-medium mt-1', statusColors[t.status as keyof typeof statusColors] || 'bg-muted text-muted-foreground')}
                    >
                      {transferStatusLabel(t.status, translate)}
                    </Badge>
                  </div>
                </div>

                <div className="pt-2 border-t border-border/40 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground text-[11px]">{translate('transferHistory.transferId')}:</span>
                  <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 tracking-wider">
                    {t.transferId}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground text-[11px]">
                    {t.isSent ? translate('transferHistory.recipientUsername') : translate('transferHistory.senderUsername')}
                  </span>
                  <span className="font-medium text-foreground">
                    {formatTransferUsername(t.isSent ? t.recipientUsername : t.senderUsername, translate)}
                  </span>
                </div>

                <div className="pt-1 flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full h-8 gap-1.5 text-xs border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50"
                    onClick={(e) => { e.stopPropagation(); handleRowSelect(t); }}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    <span>{translate('transferHistory.viewDetails')}</span>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Transfer Details Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md border border-blue-500/20 bg-background/95 backdrop-blur-sm shadow-xl">
          <DialogHeader>
            <div className="flex items-center gap-3">
              {selectedTransfer && (
                <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 shrink-0">
                  <CoinBadgeLogo coin={selectedTransfer.crypto} className="h-6 w-6" />
                </div>
              )}
              <div>
                <DialogTitle className="text-lg font-bold text-foreground">
                  {translate('transferHistory.transferDetails')}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  {translate('transferHistory.subtitle')}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {selectedTransfer && (
            <div className="space-y-3.5 text-sm divide-y divide-border/50 py-1">
              {/* Amount */}
              <div className="flex justify-between items-center pt-2">
                <span className="text-xs font-medium text-muted-foreground">{translate('transferHistory.transferAmount')}</span>
                <span className={cn(
                  'font-mono font-bold text-base',
                  selectedTransfer.isSent ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
                )}>
                  {selectedTransfer.isSent ? '-' : '+'}{selectedTransfer.amount} {selectedTransfer.crypto}
                </span>
              </div>

              {/* Historical fee amount stored on the transfer record. The current
                  platform rate may differ from the rate applied to this past transfer. */}
              {selectedTransfer.isSent && (
                <>
                  <div className="flex justify-between items-center pt-3">
                    <span className="text-xs font-medium text-muted-foreground">
                      <span>{translate('transferHistory.paxOnesFee')}</span>
                    </span>
                    <span className="font-mono text-xs font-semibold text-amber-600 dark:text-amber-400">
                      {selectedTransfer.fee} {selectedTransfer.crypto}
                    </span>
                  </div>

                  <div className="flex justify-between items-center pt-3">
                    <span className="text-xs font-bold text-foreground">{translate('transferHistory.totalDeducted')}</span>
                    <span className="font-mono font-bold text-xs text-foreground">
                      {(selectedTransfer.amount + selectedTransfer.fee).toFixed(8)} {selectedTransfer.crypto}
                    </span>
                  </div>
                </>
              )}

              {/* Status */}
              <div className="flex justify-between items-center pt-3">
                <span className="text-xs font-medium text-muted-foreground">{translate('transferHistory.statusLabel')}</span>
                <Badge
                  variant="outline"
                  className={cn('capitalize text-xs font-medium', statusColors[selectedTransfer.status as keyof typeof statusColors] || 'bg-muted text-muted-foreground')}
                >
                  {transferStatusLabel(selectedTransfer.status, translate)}
                </Badge>
              </div>

              {/* 12-char Transfer ID */}
              <div className="flex justify-between items-center pt-3">
                <span className="text-xs font-medium text-muted-foreground">{translate('transferHistory.transferId12')}</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 tracking-wider">
                    {selectedTransfer.transferId}
                  </span>
                  <button
                    onClick={() => copyToClipboard(selectedTransfer.transferId, 'tid')}
                    className="text-muted-foreground hover:text-foreground p-1 transition"
                    title={translate('transferHistory.copyTooltip')}
                  >
                    {copiedField === 'tid' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {/* Recipient / Sender Username */}
              <div className="flex justify-between items-center pt-3">
                <span className="text-xs font-medium text-muted-foreground">
                  {selectedTransfer.isSent ? translate('transferHistory.recipientUsername') : translate('transferHistory.senderUsername')}
                </span>
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-muted font-mono text-foreground flex items-center gap-1">
                  <UserIcon className="h-3 w-3 text-blue-500" />
                  {formatTransferUsername(selectedTransfer.isSent ? selectedTransfer.recipientUsername : selectedTransfer.senderUsername, translate)}
                </span>
              </div>

              {/* Date & Time */}
              <div className="flex justify-between items-center pt-3">
                <span className="text-xs font-medium text-muted-foreground">{translate('transferHistory.dateTimeLabel')}</span>
                <span className="text-xs font-medium text-foreground">
                  {selectedTransfer.createdAt ? new Date(selectedTransfer.createdAt).toLocaleString(language, {
                    dateStyle: 'medium',
                    timeStyle: 'medium',
                  }) : translate('transferHistory.notAvailable')}
                </span>
              </div>

              {/* Network / Type */}
              <div className="flex justify-between items-center pt-3">
                <span className="text-xs font-medium text-muted-foreground">{translate('transferHistory.transferType')}</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  {translate('transferHistory.offchainInstantInternal')}
                </span>
              </div>
            </div>
          )}

          <div className="mt-5 flex justify-end">
            <Button
              variant="outline"
              className="w-full h-9 text-xs border-border/80"
              onClick={() => setIsDialogOpen(false)}
            >
              {translate('transferHistory.close')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Export TransferHistoryTable alias for backward compatibility with existing pages
export const TransferHistoryTable = TransferHistoryList;
export default TransferHistoryList;

