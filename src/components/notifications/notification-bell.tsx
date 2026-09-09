'use client';

import React from 'react';
import Link from 'next/link';
import { Bell, CheckCheck, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuHeader,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useNotifications } from '@/components/notifications-provider';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

export function NotificationBell() {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9 text-foreground">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground shadow-sm">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
          <span className="sr-only">Toggle notifications</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 sm:w-96 p-0 max-h-[480px] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-3 border-b bg-card">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-sm">Notifications</h4>
            {unreadCount > 0 && (
              <span className="text-xs font-mono bg-primary/15 text-primary px-2 py-0.5 rounded-full font-bold">
                {unreadCount} new
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markAllAsRead()}
              className="text-xs h-7 px-2 text-muted-foreground hover:text-foreground"
            >
              <CheckCheck className="h-3.5 w-3.5 mr-1" />
              Mark all read
            </Button>
          )}
        </div>

        <div className="overflow-y-auto max-h-[380px] divide-y divide-border/60">
          {notifications.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>No notifications yet</p>
            </div>
          ) : (
            notifications.map((n) => {
              let timeAgo = '';
              try {
                timeAgo = formatDistanceToNow(new Date(n.createdAt), { addSuffix: true });
              } catch (e) {
                timeAgo = '';
              }

              const content = (
                <div
                  className={cn(
                    'flex items-start gap-3 p-3 transition-colors hover:bg-muted/60 cursor-pointer',
                    !n.isRead && 'bg-primary/5 dark:bg-primary/10'
                  )}
                  onClick={() => {
                    if (!n.isRead) markAsRead(n.id);
                  }}
                >
                  {/* Counterparty Profile Avatar / DP */}
                  <Avatar className="h-9 w-9 shrink-0 border border-border">
                    {n.senderPhotoURL && <AvatarImage src={n.senderPhotoURL} alt={n.senderUsername || 'Trader'} />}
                    <AvatarFallback className="bg-primary/15 text-primary font-bold text-xs">
                      {n.senderUsername ? n.senderUsername.substring(0, 2).toUpperCase() : 'TR'}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-xs font-bold truncate text-foreground">
                        {n.title || (n.senderUsername ? `@${n.senderUsername}` : 'Trade Alert')}
                      </p>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">{timeAgo}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">
                      {n.message}
                    </p>
                  </div>
                </div>
              );

              if (n.link) {
                return (
                  <Link key={n.id} href={n.link} className="block">
                    {content}
                  </Link>
                );
              }

              return <div key={n.id}>{content}</div>;
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default NotificationBell;
