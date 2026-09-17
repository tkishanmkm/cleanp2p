'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

export function usePresence(userId?: string) {
  const supabase = createClient();

  useEffect(() => {
    if (!userId) return;

    const sendHeartbeat = async () => {
      try {
        const { error } = await supabase.rpc('update_user_presence', { user_id: userId });
        if (error) {
          await supabase
            .from('profiles')
            .update({ 
              last_seen: new Date().toISOString(), 
              last_seen_at: new Date().toISOString(),
              is_online: true 
            })
            .eq('id', userId);
        }
      } catch {
        try {
          await supabase
            .from('profiles')
            .update({ 
              last_seen: new Date().toISOString(), 
              last_seen_at: new Date().toISOString(),
              is_online: true 
            })
            .eq('id', userId);
        } catch {}
      }
    };

    // Send initial heartbeat on mount
    sendHeartbeat();

    // Pulse presence every 60 seconds (1 minute)
    const interval = setInterval(sendHeartbeat, 60000);

    return () => clearInterval(interval);
  }, [userId, supabase]);
}

/**
 * Utility to check online status based on last_seen timestamp
 */
export function isUserOnline(lastSeenTimestamp?: string | Date | null): boolean {
  if (!lastSeenTimestamp) return false;
  const lastSeen = new Date(lastSeenTimestamp).getTime();
  const now = Date.now();
  // Marked as Online if last seen within the last 2 minutes (120,000 ms)
  return now - lastSeen < 120000;
}

export default usePresence;

