'use client';

import { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
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
import { Skeleton } from '@/components/ui/skeleton';
import type { EscrowLedger, CryptoCurrency } from '@/lib/types';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { useToast } from '@/hooks/use-toast';
import { toDate } from '@/lib/utils';
import { BtcLogo, EthLogo, LtcLogo, UsdtLogo } from '@/components/icons';
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

export default function AdminEscrowPage() {
  const { isAdmin, isLoading: isAdminLoading } = useAdminStatus();
  const { toast } = useToast();
  const [ledgerEntries, setLedgerEntries] = useState<EscrowLedger[] | null>(null);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (isAdminLoading) return;
    if (!isAdmin) {
      setIsLoading(false);
      return;
    }

    const fetchLedger = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('escrow_ledger')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) {
          // Table might be empty or fallback
          console.warn('Escrow ledger query note:', error.message);
        }

        const entries: EscrowLedger[] = (data || []).map((doc: any) => ({
          id: doc.id,
          tradeId: doc.trade_id || doc.tradeId,
          feeAmount: Number(doc.fee_amount || doc.feeAmount || 0),
          crypto: doc.crypto || 'USDT',
          createdAt: doc.created_at || doc.createdAt || new Date().toISOString(),
          adminId: doc.admin_id || doc.adminId,
        }));

        setLedgerEntries(entries);

        const calculatedTotals = entries.reduce((acc, entry) => {
          if (!acc[entry.crypto]) acc[entry.crypto] = 0;
          acc[entry.crypto] += entry.feeAmount;
          return acc;
        }, {} as Record<string, number>);
        setTotals(calculatedTotals);
      } catch (error) {
        toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch escrow ledger data.' });
      } finally {
        setIsLoading(false);
      }
    };

    fetchLedger();
  }, [isAdmin, isAdminLoading, toast]);

  return (
    <>
      <div className="flex items-center">
        <h1 className="text-lg font-semibold md:text-2xl">Escrow Fee Balance</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-4 w-24" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-7 w-32" />
                </CardContent>
              </Card>
            ))
          : Object.entries(totals).map(([crypto, total]) => (
              <Card key={crypto}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total {crypto} Fees</CardTitle>
                  <CryptoLogo crypto={crypto as CryptoCurrency} className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{total.toFixed(8)}</div>
                </CardContent>
              </Card>
            ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Fee Transactions</CardTitle>
          <CardDescription>A log of all escrow fees collected from completed trades.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Trade ID</TableHead>
                <TableHead>Fee Amount</TableHead>
                <TableHead>Asset</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!isLoading &&
                ledgerEntries &&
                ledgerEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{toDate(entry.createdAt)?.toLocaleDateString()}</TableCell>
                    <TableCell className="font-mono text-xs">{entry.tradeId}</TableCell>
                    <TableCell className="font-medium">{entry.feeAmount.toFixed(8)}</TableCell>
                    <TableCell>{entry.crypto}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
