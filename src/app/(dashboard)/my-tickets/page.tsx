'use client';

import { useAuth } from '@/components/providers/auth-provider';
import { supabase } from '@/lib/supabase/client';
import type { SupportTicket } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Skeleton } from '@/components/ui/skeleton';
import { MailQuestion, CheckCircle, Hourglass, Loader2 } from 'lucide-react';
import { toDate } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { formatDistanceToNow } from 'date-fns';

export default function MyTicketsPage() {
    const { user: authUser, profile, isUserLoading } = useAuth();
    const router = useRouter();

    const [tickets, setTickets] = useState<SupportTicket[]>([]);
    const [areTicketsLoading, setAreTicketsLoading] = useState(true);

    useEffect(() => {
        if (!isUserLoading && !authUser) {
            router.push('/login');
        }
    }, [isUserLoading, authUser, router]);

    const fetchTickets = useCallback(async () => {
        if (!authUser?.uid) return;
        setAreTicketsLoading(true);
        try {
            const username = profile?.username || authUser.displayName || '';
            const { data, error } = await supabase
                .from('support_tickets')
                .select('*')
                .or(`user_id.eq.${authUser.uid},userId.eq.${authUser.uid},userId.eq.${username}`)
                .order('created_at', { ascending: false });

            if (error) throw error;

            const mapped: SupportTicket[] = (data || []).map((t: any) => ({
                id: t.id,
                userId: t.user_id || t.userId,
                category: t.category,
                subject: t.subject,
                message: t.message,
                status: t.status || 'Open',
                resolutionNote: t.resolution_note || t.resolutionNote,
                createdAt: t.created_at || t.createdAt,
            }));

            setTickets(mapped);
        } catch (err) {
            console.error('Error fetching support tickets:', err);
        } finally {
            setAreTicketsLoading(false);
        }
    }, [authUser?.uid, authUser?.displayName, profile?.username]);

    useEffect(() => {
        fetchTickets();
    }, [fetchTickets]);
    
    const isLoading = isUserLoading || areTicketsLoading;

    const getStatusIcon = (status: SupportTicket['status']) => {
        switch (status) {
            case 'Open': return <Hourglass className="h-5 w-5 text-red-500" />;
            case 'In Progress': return <Loader2 className="h-5 w-5 text-yellow-500 animate-spin" />;
            case 'Closed': return <CheckCircle className="h-5 w-5 text-green-500" />;
            default: return <MailQuestion className="h-5 w-5" />;
        }
    };

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
        );
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
