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
import { ar, enUS, es, fr, hi, ko, ptBR, ru, vi, zhCN, zhTW } from 'date-fns/locale';
import { useI18n } from '@/context/i18n-context';

const dateFnsLocaleByLanguage = {
    en: enUS,
    'zh-CN': zhCN,
    'zh-TW': zhTW,
    'pt-BR': ptBR,
    ko,
    fr,
    es,
    ru,
    vi,
    ar,
    hi,
};

function normalizeTicketStatus(status: SupportTicket['status']): 'open' | 'in-progress' | 'closed' | 'unknown' {
    const normalized = String(status || '').trim().toLowerCase().replace(/[_]+/g, '-');
    if (normalized === 'open') return 'open';
    if (normalized === 'in progress' || normalized === 'in-progress') return 'in-progress';
    if (normalized === 'closed') return 'closed';
    return 'unknown';
}

function getTicketStatusLabel(status: SupportTicket['status'], t: (key: string) => string): string {
    switch (normalizeTicketStatus(status)) {
        case 'open': return t('myTicketsPage.statusOpen');
        case 'in-progress': return t('myTicketsPage.statusInProgress');
        case 'closed': return t('myTicketsPage.statusClosed');
        default: return String(status || '');
    }
}

export default function MyTicketsPage() {
    const { user: authUser, isUserLoading } = useAuth();
    const { t, language } = useI18n();
    const dateFnsLocale = dateFnsLocaleByLanguage[language as keyof typeof dateFnsLocaleByLanguage] || enUS;
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
            const { data, error } = await supabase
                .from('support_tickets')
                .select('*')
                .eq('user_id', authUser.uid)
                .order('created_at', { ascending: false });

            if (error) throw error;

            const mapped: SupportTicket[] = (data || []).map((t: any) => ({
                id: t.id,
                userId: t.user_id || t.userId,
                email: t.email || authUser.email || '',
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
    }, [authUser?.uid, authUser?.email]);

    useEffect(() => {
        fetchTickets();
    }, [fetchTickets]);
    
    const isLoading = isUserLoading || areTicketsLoading;

    const getStatusIcon = (status: SupportTicket['status']) => {
        switch (normalizeTicketStatus(status)) {
            case 'open': return <Hourglass className="h-5 w-5 text-red-500" />;
            case 'in-progress': return <Loader2 className="h-5 w-5 text-yellow-500 animate-spin" />;
            case 'closed': return <CheckCircle className="h-5 w-5 text-green-500" />;
            default: return <MailQuestion className="h-5 w-5" />;
        }
    };

    if (isLoading) {
        return (
            <div className="space-y-4">
                 <div className="flex items-center">
                    <h1 className="text-lg font-semibold md:text-2xl">{t('myTicketsPage.title')}</h1>
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
                <h1 className="text-lg font-semibold md:text-2xl">{t('myTicketsPage.title')}</h1>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>{t('myTicketsPage.submittedTitle')}</CardTitle>
                    <CardDescription>{t('myTicketsPage.description')}</CardDescription>
                </CardHeader>
                <CardContent>
                    {tickets && tickets.length > 0 ? (
                        <Accordion type="single" collapsible className="w-full">
                            {tickets.map(ticket => {
                                const submittedAt = toDate(ticket.createdAt);
                                return (
                                <AccordionItem value={ticket.id} key={ticket.id}>
                                    <AccordionTrigger>
                                        <div className="flex items-center gap-4 w-full">
                                            {getStatusIcon(ticket.status)}
                                            <div className="flex-grow text-left">
                                                <p className="font-medium truncate">{ticket.message}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {submittedAt
                                                        ? t('myTicketsPage.submittedAt').replace('{time}', formatDistanceToNow(submittedAt, { addSuffix: true, locale: dateFnsLocale }))
                                                        : ''}
                                                </p>
                                            </div>
                                            <Badge variant={normalizeTicketStatus(ticket.status) === 'closed' ? 'default' : 'outline'}>{getTicketStatusLabel(ticket.status, t)}</Badge>
                                        </div>
                                    </AccordionTrigger>
                                    <AccordionContent className="space-y-4">
                                        <div>
                                            <h4 className="font-semibold mb-2">{t('myTicketsPage.yourMessage')}</h4>
                                            <p className="text-sm text-muted-foreground p-4 bg-muted rounded-md whitespace-pre-wrap">{ticket.message}</p>
                                        </div>
                                        {ticket.resolutionNote && (
                                            <div>
                                                <h4 className="font-semibold mb-2">{t('myTicketsPage.adminReply')}</h4>
                                                <p className="text-sm p-4 bg-green-100 dark:bg-green-900/30 rounded-md whitespace-pre-wrap">{ticket.resolutionNote}</p>
                                            </div>
                                        )}
                                    </AccordionContent>
                                </AccordionItem>
                                );
                            })}
                        </Accordion>
                    ) : (
                        <div className="text-center py-16">
                            <MailQuestion className="mx-auto h-12 w-12 text-muted-foreground" />
                            <h3 className="mt-4 text-lg font-semibold">{t('myTicketsPage.noTicketsFound')}</h3>
                            <p className="mt-1 text-sm text-muted-foreground">{t('myTicketsPage.noTicketsYet')}</p>
                        </div>
                    )}
                </CardContent>
            </Card>
        </>
    );
}
