import { supabase } from '@/lib/supabase/client';
import type { Notification } from '@/lib/types';

export interface AppNotification {
  id: string;
  user_id: string;
  title?: string;
  message: string;
  link?: string;
  is_read: boolean;
  sender_photo_url?: string | null;
  sender_username?: string | null;
  created_at: string;
}

/**
 * Fetch all notifications for a specific user from Supabase.
 * Automatically prunes/deletes notification records older than 10 days.
 */
export async function getUserNotifications(userId: string): Promise<Notification[]> {
  try {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

    // 1. Auto-delete activity logs older than 10 days from database
    try {
      await supabase
        .from('notifications')
        .delete()
        .eq('user_id', userId)
        .lt('created_at', tenDaysAgo);
    } catch (cleanupErr) {
      console.warn('Notification auto-clean notice:', cleanupErr);
    }

    // 2. Fetch current 10-day notifications
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', tenDaysAgo)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching notifications:', error);
      return [];
    }

    return (data || []).map((n) => ({
      id: n.id,
      userId: n.user_id,
      title: n.title || 'Notification',
      message: n.message || n.title || '',
      link: n.link || undefined,
      isRead: n.is_read ?? false,
      senderPhotoURL: n.sender_photo_url || undefined,
      senderUsername: n.sender_username || undefined,
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
  link?: string,
  senderPhotoURL?: string,
  senderUsername?: string
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
        sender_photo_url: senderPhotoURL || null,
        sender_username: senderUsername || null,
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
 * Helper to dispatch trade lifecycle notifications with counterparty DP
 */
export async function dispatchTradeNotification({
  recipientId,
  title,
  message,
  tradeId,
  senderPhotoURL,
  senderUsername,
}: {
  recipientId: string;
  title: string;
  message: string;
  tradeId: string;
  senderPhotoURL?: string;
  senderUsername?: string;
}) {
  if (!recipientId) return;
  return createNotification(
    recipientId,
    message,
    title,
    `/trade/${tradeId}`,
    senderPhotoURL,
    senderUsername
  );
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
          title: newRecord.title || 'Notification',
          message: newRecord.message || newRecord.title || '',
          link: newRecord.link || undefined,
          isRead: newRecord.is_read ?? false,
          senderPhotoURL: newRecord.sender_photo_url || undefined,
          senderUsername: newRecord.sender_username || undefined,
          createdAt: newRecord.created_at,
        });
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
