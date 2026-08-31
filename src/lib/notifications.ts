import { supabase } from '@/lib/supabase/client';
import type { Notification } from '@/lib/types';

export interface AppNotification {
  id: string;
  user_id: string;
  title?: string;
  message: string;
  link?: string;
  is_read: boolean;
  created_at: string;
}

/**
 * Fetch all notifications for a specific user from Supabase.
 */
export async function getUserNotifications(userId: string): Promise<Notification[]> {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching notifications:', error);
      return [];
    }

    return (data || []).map((n) => ({
      id: n.id,
      userId: n.user_id,
      message: n.message || n.title || '',
      link: n.link || undefined,
      isRead: n.is_read ?? false,
      createdAt: n.created_at,
    }));
  } catch (err) {
    console.error('Failed to get notifications:', err);
    return [];
  }
}

/**
 * Mark a single notification as read in Supabase.
 */
export async function markNotificationAsRead(notificationId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId);

    if (error) {
      console.error('Error marking notification as read:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Failed to update notification:', err);
    return false;
  }
}

/**
 * Mark all notifications for a user as read.
 */
export async function markAllNotificationsAsRead(userId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      console.error('Error marking all notifications as read:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Failed to mark all as read:', err);
    return false;
  }
}

/**
 * Create a new notification for a user in Supabase.
 */
export async function createNotification(
  userId: string,
  message: string,
  title?: string,
  link?: string
): Promise<AppNotification | null> {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        title: title || 'Notification',
        message,
        link: link || null,
        is_read: false,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating notification:', error);
      return null;
    }
    return data as AppNotification;
  } catch (err) {
    console.error('Failed to create notification:', err);
    return null;
  }
}

/**
 * Subscribe to Supabase Realtime channel for live notifications.
 */
export function subscribeToUserNotifications(
  userId: string,
  onNewNotification: (notification: Notification) => void
) {
  const channel = supabase
    .channel(`notifications:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const newRecord = payload.new as AppNotification;
        onNewNotification({
          id: newRecord.id,
          userId: newRecord.user_id,
          message: newRecord.message || newRecord.title || '',
          link: newRecord.link,
          isRead: newRecord.is_read ?? false,
          createdAt: newRecord.created_at,
        });
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
