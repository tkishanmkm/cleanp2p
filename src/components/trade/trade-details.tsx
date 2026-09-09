'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { RefreshCw, Loader2, Flag } from 'lucide-react';

interface Trade {
    id: string;
    tradeId: string;
    buyerId: string;
    sellerId: string;
    crypto: string;
    amount: number;
    fiatCurrency: string;
    fiatAmount: number;
    price: number;
    status: string;
    paymentMethod?: string;
    createdAt: string;
    paidAt?: string;
    releasedAt?: string;
}

function DetailRow({ label, value, valueClass, isLink = false, href = '#' }: { label: string, value: string | React.ReactNode, valueClass?: string, isLink?: boolean, href?: string }) {
    const valueContent = isLink ? (
      <Button variant="link" asChild className="p-0 h-auto font-medium text-right"><Link href={href}>{value}</Link></Button>
    ) : (<p className={cn(`font-medium text-right text-foreground`, valueClass)}>{value}</p>);
    return (<div className="flex justify-between items-center text-sm"><p className="text-muted-foreground">{label}</p>{valueContent}</div>);
}

export function TradeDetails({ trade, currentUserRole }: { trade: Trade; currentUserRole: 'buy' | 'sell'; }) {
  const { toast } = useToast();
  const isBuying = currentUserRole === 'buy';
  const showReopen = ['cancelled', 'expired'].includes(trade.status);
  const [disputeReason, setDisputeReason] = useState('');
  const [isSubmittingDispute, setIsSubmittingDispute] = useState(false);

  const handleMarkAsPaid = async () => {
    const { error } = await supabase.from('trades').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', trade.id);
    if (error) toast({ variant: 'destructive', title: 'Error', description: error.message });
    else toast({ title: 'Success', description: 'Seller has been notified that you have paid.' });
  };

  const handleReleaseCrypto = async () => {
    const { error } = await supabase.from('trades').update({ status: 'released', released_at: new Date().toISOString() }).eq('id', trade.id);
    if (error) toast({ variant: 'destructive', title: 'Error', description: error.message });
    else toast({ title: 'Crypto Released', description: 'The trade has been completed successfully.' });
  };

  const handleOpenDispute = async () => {
    if (!disputeReason.trim()) return;
    setIsSubmittingDispute(true);
    const { error } = await supabase.from('trade_disputes').insert({
        trade_id: trade.id,
        opened_by: isBuying ? trade.buyerId : trade.sellerId,
        reason: 'User Dispute',
        explanation: disputeReason,
        status: 'open'
    });
    if (!error) {
        await supabase.from('trades').update({ status: 'disputed' }).eq('id', trade.id);
        toast({ title: 'Dispute Opened', description: 'A moderator has been alerted.' });
    }
    setIsSubmittingDispute(false);
  };

  return (
    <Card className="flex flex-col h-full shadow-none border-0 rounded-none bg-background text-foreground">
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-foreground">Trade Details</CardTitle>
            <CardDescription className="text-muted-foreground">ID: {trade?.tradeId || 'N/A'}</CardDescription>
          </div>
          <Badge variant="outline" className="capitalize">{trade?.status || 'unknown'}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto space-y-4">
        <div className="space-y-2 rounded-md border border-border p-4 bg-card">
          <DetailRow label={isBuying ? "You are buying" : "You are selling"} value={`${trade?.amount ?? 0} ${trade?.crypto ?? ''}`} />
          <DetailRow label="Price" value={`1 ${trade?.crypto ?? ''} = ${(trade?.price ?? 0).toLocaleString()} ${trade?.fiatCurrency ?? ''}`} />
          <hr className="my-2 border-dashed border-border" />
          <DetailRow label={isBuying ? "You will pay" : "You will receive"} value={`${(trade?.fiatAmount ?? 0).toLocaleString()} ${trade?.fiatCurrency ?? ''}`} valueClass={isBuying ? "text-lg font-bold text-destructive" : "text-lg font-bold text-green-600"} />
        </div>
        
        <div className="space-y-2 pt-2">
            {isBuying && trade.status === 'active' && (
                <AlertDialog>
                    <AlertDialogTrigger asChild><Button className="w-full" size="lg">Mark as Paid</Button></AlertDialogTrigger>
                    <AlertDialogContent className="bg-background text-foreground">
                        <AlertDialogHeader>
                            <AlertDialogTitle>Confirm Payment</AlertDialogTitle>
                            <AlertDialogDescription className="text-muted-foreground">Have you sent <span className="font-bold">{trade.fiatAmount} {trade.fiatCurrency}</span> to the seller?</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleMarkAsPaid}>Yes, I Have Paid</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}

            {!isBuying && (trade.status === 'paid' || trade.status === 'disputed') && (
                <AlertDialog>
                    <AlertDialogTrigger asChild><Button className="w-full" size="lg">Release Crypto</Button></AlertDialogTrigger>
                    <AlertDialogContent className="bg-background text-foreground">
                        <AlertDialogHeader>
                            <AlertDialogTitle>Release Cryptocurrency?</AlertDialogTitle>
                            <AlertDialogDescription className="text-muted-foreground">Confirm you have received your fiat payment. This action is irreversible.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleReleaseCrypto}>Confirm and Release</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}

            {trade.status === 'paid' && (
                <AlertDialog>
                    <AlertDialogTrigger asChild><Button variant="destructive" className="w-full"><Flag className="mr-2 h-4 w-4" /> Open Dispute</Button></AlertDialogTrigger>
                    <AlertDialogContent className="bg-background text-foreground">
                        <AlertDialogHeader>
                            <AlertDialogTitle>Open Dispute</AlertDialogTitle>
                            <AlertDialogDescription className="text-muted-foreground">Explain why you are opening a dispute for trade {trade.tradeId}.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <div className="py-2">
                            <Textarea placeholder="Explain the issue..." value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} />
                        </div>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleOpenDispute} disabled={isSubmittingDispute}>
                                {isSubmittingDispute && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Submit Dispute
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}
        </div>

        <div className="space-y-2">
            <h4 className="font-semibold text-foreground">Timestamps</h4>
            <DetailRow label="Created At" value={trade?.createdAt ? new Date(trade.createdAt).toLocaleString() : 'N/A'} />
            {trade?.paidAt && <DetailRow label="Paid At" value={new Date(trade.paidAt).toLocaleString()} />}
            {trade?.releasedAt && <DetailRow label="Released At" value={new Date(trade.releasedAt).toLocaleString()} />}
        </div>

        {showReopen && (
            <Button asChild variant="outline" className="w-full mt-6">
                <Link href="/p2p"><RefreshCw className="mr-2 h-4 w-4" /> Return to P2P Marketplace</Link>
            </Button>
        )}
      </CardContent>
    </Card>
  );
}
