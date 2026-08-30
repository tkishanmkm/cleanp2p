'use client';
import { useMemo } from 'react';
import { useCollection, useMemoFirebase, useFirebase } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import type { CoinTransfer } from '@/lib/types';
import { toDate } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';

interface TransferHistoryTableProps {
  userId: string;
  type: 'sent' | 'received';
  onRowClick: (transfer: CoinTransfer) => void;
}

export function TransferHistoryTable({ userId, type, onRowClick }: TransferHistoryTableProps) {
  const { firestore } = useFirebase();

  const transfersQuery = useMemoFirebase(() => {
    if (!firestore || !userId) return null;
    const field = type === 'sent' ? 'senderId' : 'recipientId';
    // Removed orderBy from the query to avoid needing a composite index
    return query(collection(firestore, 'transfers'), where(field, '==', userId));
  }, [firestore, userId, type]);

  const { data: transfers, isLoading } = useCollection<CoinTransfer>(transfersQuery);

  // Sort the transfers on the client-side
  const sortedTransfers = useMemo(() => {
    if (!transfers) return null;
    return [...transfers].sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
  }, [transfers]);


  if (isLoading) {
    return (
        <div className="space-y-2 p-2 md:p-0">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
        </div>
    );
  }

  if (!sortedTransfers || sortedTransfers.length === 0) {
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
                {sortedTransfers.map((t) => (
                    <TableRow key={t.id} onClick={() => onRowClick(t)} className="cursor-pointer">
                    <TableCell className="font-mono text-xs">{t.publicId}</TableCell>
                    <TableCell>
                        {type === 'sent' ? t.recipientUsername : t.senderUsername}
                    </TableCell>
                    <TableCell className="font-medium">
                        {t.amount.toFixed(8)} {t.crypto}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                        {toDate(t.createdAt)?.toLocaleString() ?? 'N/A'}
                    </TableCell>
                    </TableRow>
                ))}
                </TableBody>
            </Table>
        </div>
        <div className="grid gap-4 md:hidden">
            {sortedTransfers.map(t => (
                <Card key={t.id} onClick={() => onRowClick(t)} className="cursor-pointer">
                    <CardHeader>
                        <div className="flex justify-between items-start">
                            <CardTitle className="text-base">{t.amount.toFixed(6)} {t.crypto}</CardTitle>
                            <p className="text-xs text-muted-foreground">{type === 'sent' ? `To: ${t.recipientUsername}` : `From: ${t.senderUsername}`}</p>
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