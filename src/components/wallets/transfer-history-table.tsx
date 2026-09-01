'use client';
import { useState, useEffect, useCallback } from 'react';
import type { CoinTransfer } from '@/lib/types';
import { toDate } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { supabase } from '@/lib/supabase/client';

interface TransferHistoryTableProps {
  userId: string;
  type: 'sent' | 'received';
  onRowClick: (transfer: CoinTransfer) => void;
}

export function TransferHistoryTable({ userId, type, onRowClick }: TransferHistoryTableProps) {
  const [transfers, setTransfers] = useState<CoinTransfer[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchTransfers = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    const field = type === 'sent' ? 'sender_id' : 'recipient_id';
    try {
      const { data, error } = await supabase
        .from('transfers')
        .select('*')
        .eq(field, userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const mapped: CoinTransfer[] = (data || []).map((t: any) => ({
        id: t.id,
        publicId: t.public_id || t.id,
        senderId: t.sender_id,
        senderUsername: t.sender_username,
        recipientId: t.recipient_id,
        recipientUsername: t.recipient_username,
        crypto: t.crypto,
        amount: Number(t.amount || 0),
        status: t.status,
        createdAt: t.created_at,
      }));

      setTransfers(mapped);
    } catch (err) {
      console.error('Failed to load transfers from Supabase:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userId, type]);

  useEffect(() => {
    fetchTransfers();
  }, [fetchTransfers]);

  if (isLoading) {
    return (
      <div className="space-y-2 p-2 md:p-0">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (!transfers || transfers.length === 0) {
    return (
      <div className="h-24 text-center flex items-center justify-center text-muted-foreground">
        No {type} transfers yet.
      </div>
    );
  }

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>{type === 'sent' ? 'Recipient' : 'Sender'}</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transfers.map((t) => (
              <TableRow key={t.id} onClick={() => onRowClick(t)} className="cursor-pointer">
                <TableCell className="font-mono text-xs">{t.publicId}</TableCell>
                <TableCell>{type === 'sent' ? t.recipientUsername : t.senderUsername}</TableCell>
                <TableCell className="font-medium">
                  {t.amount.toFixed(8)} {t.crypto}
                </TableCell>
                <TableCell className="text-muted-foreground">{toDate(t.createdAt)?.toLocaleString() ?? 'N/A'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="grid gap-4 md:hidden">
        {transfers.map((t) => (
          <Card key={t.id} onClick={() => onRowClick(t)} className="cursor-pointer">
            <CardHeader>
              <div className="flex justify-between items-start">
                <CardTitle className="text-base">
                  {t.amount.toFixed(6)} {t.crypto}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {type === 'sent' ? `To: ${t.recipientUsername}` : `From: ${t.senderUsername}`}
                </p>
              </div>
              <CardDescription className="font-mono text-xs">{t.publicId}</CardDescription>
            </CardHeader>
            <CardFooter className="text-xs text-muted-foreground">
              {toDate(t.createdAt)?.toLocaleString('default', { dateStyle: 'short', timeStyle: 'short' })}
            </CardFooter>
          </Card>
        ))}
      </div>
    </>
  );
}
