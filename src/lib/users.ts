'use client';
import { supabase } from '@/lib/supabase/client';
import { countries } from './countries';

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
  const userId = user.uid || user.id;
  if (!userId) return;

  const simulatedIp = `192.168.1.${Math.floor(Math.random() * 254) + 1}`;
  const randomIpCountry = countries[Math.floor(Math.random() * countries.length)].code;

  try {
    const { data } = await supabase
      .from('user_sessions')
      .insert([
        {
          user_id: userId,
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
          ip_address: simulatedIp,
          last_login: new Date().toISOString(),
          is_active: true,
        },
      ])
      .select('id')
      .single();

    await supabase
      .from('profiles')
      .update({ ip_based_country: randomIpCountry })
      .eq('id', userId);

    return data?.id;
  } catch (err) {
    console.error('createUserSession failed:', err);
  }
}

export async function logoutSessions(_db: any, userId: string, sessionIdsToLogout: string[]) {
  if (!userId || !sessionIdsToLogout || sessionIdsToLogout.length === 0) {
    throw new Error('User ID and session IDs are required.');
  }

  await supabase
    .from('user_sessions')
    .update({ is_active: false })
    .in('id', sessionIdsToLogout)
    .eq('user_id', userId);
}
