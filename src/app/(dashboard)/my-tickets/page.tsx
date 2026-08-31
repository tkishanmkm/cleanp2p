
'use client';

import { useAuth } from '@/components/providers/auth-provider';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where, orderBy } from 'firebase/firestore';
import type { SupportTicket } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Skeleton } from '@/components/ui/skeleton';
import { MailQuestion, CheckCircle, Hourglass, Loader2 } from 'lucide-react';
import { toDate } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';

export default function MyTicketsPage() {
    const { user: authUser, isUserLoading } = useAuth();
    const { firestore } = useFirebase();
    const router = useRouter();

    useEffect(() => {
        if (!isUserLoading && !authUser) {
            router.push('/login');
        }
    }, [isUserLoading, authUser, router]);

    const ticketsQuery = useMemoFirebase(
        () => (authUser?.displayName && firestore ? query(collection(firestore, "support_tickets"), where("userId", "==", authUser.displayName), orderBy("createdAt", "desc")) : null),
        [authUser?.displayName, firestore]
    );
    const { data: tickets, isLoading: areTicketsLoading } = useCollection<SupportTicket>(ticketsQuery);
    
    const isLoading = isUserLoading || areTicketsLoading;

    const getStatusIcon = (status: SupportTicket['status']) => {
        switch (status) {
            case 'Open': return <Hourglass className="h-5 w-5 text-red-500" />;
            case 'In Progress': return <Loader2 className="h-5 w-5 text-yellow-500 animate-spin" />;
            case 'Closed': return <CheckCircle className="h-5 w-5 text-green-500" />;
            default: return <MailQuestion className="h-5 w-5" />;
        }
    }

    if (isLoading) {
        return (
            <div className="space-y-4">
                 <div className="flex items-center">
                    <h1 className="text-lg font-semibold md:text-2xl">My Support Tickets</h1>
                </div>
                <Card>
                    <CardHeader>
                        <Skeleton className="h-8 w-1/2" />
                        <Skeleton className="h-4 w-3/4" />
                    </CardHeader>
                    <CardContent className="space-y-2">
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <>
            <div className="flex items-center">
                <h1 className="text-lg font-semibold md:text-2xl">My Support Tickets</h1>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Your Submitted Tickets</CardTitle>
                    <CardDescription>Here is a history of your support requests and their status.</CardDescription>
                </CardHeader>
                <CardContent>
                    {tickets && tickets.length > 0 ? (
                        <Accordion type="single" collapsible className="w-full">
                            {tickets.map(ticket => (
                                <AccordionItem value={ticket.id} key={ticket.id}>
                                    <AccordionTrigger>
                                        <div className="flex items-center gap-4 w-full">
                                            {getStatusIcon(ticket.status)}
                                            <div className="flex-grow text-left">
                                                <p className="font-medium truncate">{ticket.message}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    Submitted {toDate(ticket.createdAt) ? formatDistanceToNow(toDate(ticket.createdAt)!) + ' ago' : ''}
                                                </p>
                                            </div>
                                            <Badge variant={ticket.status === 'Closed' ? 'default' : 'outline'}>{ticket.status}</Badge>
                                        </div>
                                    </AccordionTrigger>
                                    <AccordionContent className="space-y-4">
                                        <div>
                                            <h4 className="font-semibold mb-2">Your Message:</h4>
                                            <p className="text-sm text-muted-foreground p-4 bg-muted rounded-md whitespace-pre-wrap">{ticket.message}</p>
                                        </div>
                                        {ticket.resolutionNote && (
                                            <div>
                                                <h4 className="font-semibold mb-2">Admin Reply:</h4>
                                                <p className="text-sm p-4 bg-green-100 dark:bg-green-900/30 rounded-md whitespace-pre-wrap">{ticket.resolutionNote}</p>
                                            </div>
                                        )}
                                    </AccordionContent>
                                </AccordionItem>
                            ))}
                        </Accordion>
                    ) : (
                        <div className="text-center py-16">
                            <MailQuestion className="mx-auto h-12 w-12 text-muted-foreground" />
                            <h3 className="mt-4 text-lg font-semibold">No Tickets Found</h3>
                            <p className="mt-1 text-sm text-muted-foreground">You have not submitted any support tickets yet.</p>
                        </div>
                    )}
                </CardContent>
            </Card>
        </>
    );
}
