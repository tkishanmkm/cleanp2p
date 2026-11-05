'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

export function usePresence(userId?: string) {
  useEffect(() => {
    if (!userId) return;

    const supabase = createClient();
    const sendHeartbeat = async (isOnline: boolean) => {
      try {
        const { error } = await supabase.rpc('set_my_presence', {
          p_is_online: isOnline,
        });
        if (error && process.env.NODE_ENV !== 'production') {
          console.warn('Presence update was not accepted:', error.code);
        }
      } catch {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('Presence update failed.');
        }
      }
    };

    void sendHeartbeat(true);
    const interval = window.setInterval(() => void sendHeartbeat(true), 60_000);

    const handlePageHide = () => {
      void sendHeartbeat(false);
    };
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('pagehide', handlePageHide);
      void sendHeartbeat(false);
    };
  }, [userId]);
}

export function isUserOnline(lastSeenTimestamp?: string | Date | null): boolean {
  if (!lastSeenTimestamp) return false;
  const lastSeen = new Date(lastSeenTimestamp).getTime();
  const now = Date.now();
  return Number.isFinite(lastSeen) && now >= lastSeen && now - lastSeen < 120_000;
}

export default usePresence;
