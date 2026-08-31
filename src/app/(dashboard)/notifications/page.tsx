'use client';

import { useAuth } from '@/components/providers/auth-provider';
import { useNotifications } from '@/components/notifications-provider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Bell, CheckCheck } from 'lucide-react';
import { toDate } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function NotificationsPage() {
  const { user, isUserLoading } = useAuth();
  const { notifications, unreadCount, isLoading, markAllAsRead, markAsRead } = useNotifications();
  const router = useRouter();

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold md:text-2xl">All Notifications</h1>
        <Button onClick={markAllAsRead} disabled={unreadCount === 0}>
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
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  onClick={() => !notification.isRead && markAsRead(notification.id)}
                  className="grid grid-cols-[25px_1fr] items-start pb-4 last:pb-0 border-b last:border-b-0 cursor-pointer hover:bg-muted/30 p-2 rounded-md transition-colors"
                >
                  {!notification.isRead ? (
                    <span className="flex h-2.5 w-2.5 translate-y-1 rounded-full bg-primary animate-pulse" />
                  ) : (
                    <span className="flex h-2 w-2 translate-y-1 rounded-full bg-muted-foreground/40" />
                  )}

                  <div className="grid gap-1">
                    <p className={`text-sm leading-snug ${!notification.isRead ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                      {notification.message}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {toDate(notification.createdAt)
                        ? formatDistanceToNow(toDate(notification.createdAt)!, { addSuffix: true })
                        : 'Just now'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-16">
              <Bell className="mx-auto h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold">No Notifications</h3>
              <p className="mt-1 text-sm">Your inbox is empty.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
