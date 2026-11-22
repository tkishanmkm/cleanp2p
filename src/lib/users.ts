'use client';
import { supabase } from '@/lib/supabase/client';

export async function blockUser(_db: any, currentUserId: string, targetUsername: string) {
  const searchResponse = await fetch(`/api/user/block-status?mode=search&q=${encodeURIComponent(targetUsername)}`, { cache: 'no-store' });
  const searchPayload = await searchResponse.json();
  if (!searchResponse.ok) throw new Error(searchPayload?.error || 'Unable to find user.');

  const normalizedTarget = targetUsername.trim().replace(/^@/, '').toLowerCase();
  const target = (Array.isArray(searchPayload?.users) ? searchPayload.users : []).find(
    (candidate: { id: string; username?: string | null }) =>
      candidate.username?.toLowerCase() === normalizedTarget || candidate.id === targetUsername.trim()
  );
  if (!target) throw new Error(`User "${targetUsername}" not found.`);
  if (currentUserId === target.id) throw new Error('You cannot block yourself.');

  const response = await fetch('/api/user/block', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetUserId: target.id, action: 'BLOCK' }),
  });
  const payload = await response.json();
  if (!response.ok || !payload?.success) throw new Error(payload?.error || 'Unable to block user.');
}

export async function unblockUser(_db: any, currentUserId: string, targetUserIdToUnblock: string) {
  if (!currentUserId || !targetUserIdToUnblock) throw new Error('User IDs are required.');
  const response = await fetch('/api/user/block', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetUserId: targetUserIdToUnblock, action: 'UNBLOCK' }),
  });
  const payload = await response.json();
  if (!response.ok || !payload?.success) throw new Error(payload?.error || 'Unable to unblock user.');
}

export async function createUserSession(_db: any, user: { uid?: string; id?: string }): Promise<string | undefined> {
  const userId = user.uid || user.id;
  if (!userId) return;

  try {
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 1000) : '';
    const deviceType = /mobile|android|iphone|ipad/i.test(userAgent)
      ? 'mobile'
      : /tablet/i.test(userAgent)
        ? 'tablet'
        : 'desktop';
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('user_sessions')
      .insert({
        user_id: userId,
        user_agent: userAgent,
        device_type: deviceType,
        is_current: true,
        last_active_at: now,
      })
      .select('id')
      .single();

    if (error) {
      console.error('createUserSession failed:', error.code || 'database_error');
      return undefined;
    }
    return data?.id;
  } catch (err) {
    console.error('createUserSession failed:', err instanceof Error ? err.name : 'UnknownError');
    return undefined;
  }
}

export async function logoutSessions(_db: any, userId: string, sessionIdsToLogout: string[]) {
  if (!userId || !sessionIdsToLogout || sessionIdsToLogout.length === 0) {
    throw new Error('User ID and session IDs are required.');
  }

  const { error } = await supabase
    .from('user_sessions')
    .update({ is_current: false })
    .in('id', sessionIdsToLogout)
    .eq('user_id', userId);

  if (error) {
    throw new Error('Unable to terminate the selected user sessions.');
  }
}
