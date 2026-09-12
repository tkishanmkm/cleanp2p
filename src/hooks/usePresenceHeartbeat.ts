'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

export function usePresenceHeartbeat(userId?: string) {
  useEffect(() => {
    if (!userId) return;

    const supabase = createClient();

    const updatePresence = async () => {
      try {
        await supabase
          .from('profiles')
          .update({
            is_online: true,
            last_seen: new Date().toISOString()
          })
          .eq('id', userId);
      } catch (err) {
        // Silently catch background heartbeat error
      }
    };

    // Update immediately on mount
    updatePresence();

    // Heartbeat ping every 60 seconds (1 minute)
    const interval = setInterval(updatePresence, 60 * 1000);

    // Set offline on tab unload
    const handleUnload = () => {
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        supabase.from('profiles').update({ is_online: false }).eq('id', userId);
      }
    };

    window.addEventListener('beforeunload', handleUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [userId]);
}

export default usePresenceHeartbeat;
