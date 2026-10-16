'use client';
import { supabase } from '@/lib/supabase/client';

export async function blockUser(_db: any, currentUserId: string, targetUsername: string) {
  // Find target user by username or userId
  const { data: targetUsers, error: userSearchError } = await supabase
    .from('profiles')
    .select('id, username')
    .eq('username', targetUsername)
    .limit(1);

  if (userSearchError || !targetUsers || targetUsers.length === 0) {
    throw new Error(`User "${targetUsername}" not found.`);
  }

  const targetUserId = targetUsers[0].id;
  if (currentUserId === targetUserId) {
    throw new Error('You cannot block yourself.');
  }

  // Get current user profile
  const { data: currentProfile } = await supabase
    .from('profiles')
    .select('blocked_users')
    .eq('id', currentUserId)
    .single();

  const existingBlocked: string[] = currentProfile?.blocked_users || [];
  if (!existingBlocked.includes(targetUserId)) {
    await supabase
      .from('profiles')
      .update({ blocked_users: [...existingBlocked, targetUserId] })
      .eq('id', currentUserId);
  }
}

export async function unblockUser(_db: any, currentUserId: string, targetUserIdToUnblock: string) {
  const { data: currentProfile } = await supabase
    .from('profiles')
    .select('blocked_users')
    .eq('id', currentUserId)
    .single();

  const existingBlocked: string[] = currentProfile?.blocked_users || [];
  const updatedBlocked = existingBlocked.filter((id) => id !== targetUserIdToUnblock);

  await supabase
    .from('profiles')
    .update({ blocked_users: updatedBlocked })
    .eq('id', currentUserId);
}

export async function createUserSession(_db: any, user: { uid?: string; id?: string }): Promise<string | undefined> {
  const requestedUserId = user.uid || user.id;
  if (!requestedUserId) return;

  try {
    const { data: { user: authenticatedUser }, error: authError } = await supabase.auth.getUser();
    if (authError || !authenticatedUser || authenticatedUser.id !== requestedUserId) {
      throw new Error('Cannot create a session for a different or unauthenticated user.');
    }
    const userId = authenticatedUser.id;
    const { data, error } = await supabase
      .from('user_sessions')
      .insert([
        {
          user_id: userId,
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
          last_login: new Date().toISOString(),
          is_active: true,
        },
      ])
      .select('id')
      .single();

    if (error) throw error;
    return data?.id;
  } catch (err) {
    console.error('createUserSession failed:', err);
  }
}

export async function logoutSessions(_db: any, userId: string, sessionIdsToLogout: string[]) {
  if (!userId || !sessionIdsToLogout || sessionIdsToLogout.length === 0) {
    throw new Error('User ID and session IDs are required.');
  }

  const { data: { user: authenticatedUser }, error: authError } = await supabase.auth.getUser();
  if (authError || !authenticatedUser || authenticatedUser.id !== userId) {
    throw new Error('You can only revoke sessions belonging to your authenticated account.');
  }

  const { error } = await supabase
    .from('user_sessions')
    .update({ is_active: false })
    .in('id', sessionIdsToLogout)
    .eq('user_id', authenticatedUser.id);

  if (error) throw error;
}
