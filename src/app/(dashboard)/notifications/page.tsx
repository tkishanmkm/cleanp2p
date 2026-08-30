
'use client';

import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, orderBy, writeBatch, doc } from 'firebase/firestore';
import type { Notification } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Bell, CheckCheck } from 'lucide-react';
import { toDate } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function NotificationsPage() {
    const { firestore, user: authUser, isUserLoading: isAuthLoading } = useFirebase();
    const { toast } = useToast();
    const router = useRouter();

    useEffect(() => {
        if (!isAuthLoading && !authUser) {
          router.push('/login');
        }
      }, [authUser, isAuthLoading, router]);

    const notificationsRef = useMemoFirebase(() => authUser ? collection(firestore, 'users', authUser.uid, 'notifications') : null, [firestore, authUser]);
    const notificationsQuery = useMemoFirebase(() => notificationsRef ? query(notificationsRef, orderBy('createdAt', 'desc')) : null, [notificationsRef]);
    const { data: notifications, isLoading } = useCollection<Notification>(notificationsQuery);
    
    const unreadCount = notifications?.filter(n => !n.isRead).length || 0;

    const handleMarkAllAsRead = async () => {
        if (!firestore || !authUser || !notifications || unreadCount === 0) return;

        const batch = writeBatch(firestore);
        notifications.forEach(notification => {
            if (!notification.isRead) {
                const notifRef = doc(firestore, 'users', authUser.uid, 'notifications', notification.id);
                batch.update(notifRef, { isRead: true });
            }
        });

        try {
            await batch.commit();
            toast({ title: 'Notifications marked as read' });
        } catch (error) {
            toast({ variant: 'destructive', title: 'Error', description: 'Could not mark notifications as read.' });
        }
    };
    
    return (
        <>
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-lg font-semibold md:text-2xl">All Notifications</h1>
                <Button onClick={handleMarkAllAsRead} disabled={unreadCount === 0}>
                    <CheckCheck className="mr-2 h-4 w-4" />
                    Mark all as read
                </Button>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Inbox</CardTitle>
                    <CardDescription>A complete history of your account notifications.</CardDescription>
                </CardHeader>
                <CardContent>
                {isLoading && (
                    <div className="space-y-4">
                        <Skeleton className="h-16 w-full" />
                        <Skeleton className="h-16 w-full" />
                        <Skeleton className="h-16 w-full" />
                    </div>
                )}
                {!isLoading && notifications && notifications.length > 0 ? (
                    <div className="space-y-4">
                        {notifications.map(notification => (
                            <div key={notification.id} className="grid grid-cols-[25px_1fr] items-start pb-4 last:pb-0 border-b last:border-b-0">
                                {!notification.isRead && <span className="flex h-2 w-2 translate-y-1 rounded-full bg-sky-500" />}
                                {notification.isRead && <span className="flex h-2 w-2 translate-y-1 rounded-full bg-muted" />}

                                <div className="grid gap-1">
                                <p className="text-sm font-medium leading-none">
                                    {notification.message}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    {toDate(notification.createdAt) ? formatDistanceToNow(toDate(notification.createdAt)!, { addSuffix: true }) : 'N/A'}
                                </p>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center text-muted-foreground py-16">
                        <Bell className="mx-auto h-12 w-12 text-muted-foreground/50"/>
                        <h3 className="mt-4 text-lg font-semibold">No Notifications</h3>
                        <p className="mt-1 text-sm">Your inbox is empty.</p>
                    </div>
                )}
                </CardContent>
            </Card>
        </>
    );
}
