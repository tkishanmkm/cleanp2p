'use client';

import { useAuth } from '@/components/providers/auth-provider';
import { useNotifications } from '@/components/notifications-provider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Bell, CheckCheck } from 'lucide-react';
import { toDate } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { ar, enUS, es, fr, hi, ko, ptBR, ru, vi, zhCN, zhTW } from 'date-fns/locale';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
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

export default function NotificationsPage() {
  const { user, isUserLoading } = useAuth();
  const { notifications, unreadCount, isLoading, markAllAsRead, markAsRead } = useNotifications();
  const { t, language } = useI18n();
  const dateFnsLocale = dateFnsLocaleByLanguage[language as keyof typeof dateFnsLocaleByLanguage] || enUS;
  const router = useRouter();

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold md:text-2xl">{t('notificationsPage.title')}</h1>
        <Button onClick={markAllAsRead} disabled={unreadCount === 0}>
          <CheckCheck className="mr-2 h-4 w-4" />
          {t('notificationsPage.markAllRead')}
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('notificationsPage.inbox')}</CardTitle>
          <CardDescription>{t('notificationsPage.description')}</CardDescription>
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
              {notifications.map((notification) => {
                const createdAt = toDate(notification.createdAt);
                return (
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
                      {createdAt
                        ? formatDistanceToNow(createdAt, { addSuffix: true, locale: dateFnsLocale })
                        : t('common.justNow')}
                    </p>
                  </div>
                </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-16">
              <Bell className="mx-auto h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold">{t('notificationsPage.noNotifications')}</h3>
              <p className="mt-1 text-sm">{t('notificationsPage.inboxEmpty')}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
