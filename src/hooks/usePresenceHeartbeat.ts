'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

export function usePresenceHeartbeat(userId?: string) {
  useEffect(() => {
    if (!userId) return;

    const supabase = createClient();
    const updatePresence = async (isOnline: boolean) => {
      try {
        const { error } = await supabase.rpc('set_my_presence', {
          p_is_online: isOnline,
        });
        if (error && process.env.NODE_ENV !== 'production') {
          console.warn('Presence update was not accepted:', error.code);
        }
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('Presence update failed.');
        }
      }
    };

    void updatePresence(true);
    const interval = window.setInterval(() => void updatePresence(true), 60_000);
    const handleUnload = () => {
      void updatePresence(false);
    };
    window.addEventListener('pagehide', handleUnload);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('pagehide', handleUnload);
      void updatePresence(false);
    };
  }, [userId]);
}

export default usePresenceHeartbeat;
