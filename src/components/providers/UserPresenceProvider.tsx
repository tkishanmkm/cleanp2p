'use client';

import React, { useEffect, useRef } from 'react';
import { createClient } from '@/utils/supabase/client';

export function useUserPresence(userId?: string | null) {
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();

    const setOnline = async () => {
      try {
        await supabase
          .from('profiles')
          .update({ is_online: true, last_seen: new Date().toISOString() })
          .eq('id', userId);
      } catch (err) {
        console.warn('Presence update error:', err);
      }
    };

    const setOffline = async () => {
      try {
        await supabase
          .from('profiles')
          .update({ is_online: false, last_seen: new Date().toISOString() })
          .eq('id', userId);
      } catch (err) {
        console.warn('Presence offline error:', err);
      }
    };

    setOnline();

    // Heartbeat update every 60 seconds (1 minute)
    const interval = setInterval(() => {
      setOnline();
    }, 60 * 1000);

    window.addEventListener('beforeunload', setOffline);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', setOffline);
      setOffline();
    };
  }, [userId]);
}

export default function UserPresenceProvider({ children }: { children: React.ReactNode }) {
  const isSyncing = useRef(false);

  useEffect(() => {
    const supabase = createClient();
    let intervalId: NodeJS.Timeout;

    async function syncPresence() {
      if (isSyncing.current) return;
      isSyncing.current = true;

      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.user) {
        isSyncing.current = false;
        return;
      }

      const updatePresence = async () => {
        try {
          await supabase
            .from('profiles')
            .update({
              is_online: true,
              last_seen: new Date().toISOString(),
            })
            .eq('id', session.user.id);
        } catch (error) {
          console.error('Failed to sync user presence:', error);
        }
      };

      // 1. Send initial heartbeat ping
      await updatePresence();

      // 2. Set interval to ping every 60 seconds (1 minute)
      intervalId = setInterval(updatePresence, 60 * 1000);

      // 3. Mark offline when user closes tab/window
      const handleBeforeUnload = () => {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (supabaseUrl && navigator.sendBeacon) {
          const payload = JSON.stringify({
            is_online: false,
            last_seen: new Date().toISOString()
          });

          const url = `${supabaseUrl}/rest/v1/profiles?id=eq.${session.user.id}`;
          navigator.sendBeacon(url, payload);
        }
      };

      window.addEventListener('beforeunload', handleBeforeUnload);

      return () => {
        clearInterval(intervalId);
        window.removeEventListener('beforeunload', handleBeforeUnload);
      };
    }

    syncPresence();

    // Cleanup on component unmount
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  return <>{children}</>;
}
