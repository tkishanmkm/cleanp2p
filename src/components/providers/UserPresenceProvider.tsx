'use client';

import React, { useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';

async function updateCurrentUserPresence(
  supabase: ReturnType<typeof createClient>,
  isOnline: boolean,
): Promise<void> {
  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.user?.id) return;

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
}

export function useUserPresence(userId?: string | null) {
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();

    void updateCurrentUserPresence(supabase, true);
    const interval = window.setInterval(() => {
      void updateCurrentUserPresence(supabase, true);
    }, 60_000);

    const handlePageHide = () => {
      void updateCurrentUserPresence(supabase, false);
    };
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('pagehide', handlePageHide);
      void updateCurrentUserPresence(supabase, false);
    };
  }, [userId]);
}

export default function UserPresenceProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const supabase = createClient();
    let isSyncing = false;

    const syncPresence = async () => {
      if (isSyncing) return;
      isSyncing = true;
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error || !session?.user?.id) return;
        const { error: presenceError } = await supabase.rpc('set_my_presence', {
          p_is_online: true,
        });
        if (presenceError && process.env.NODE_ENV !== 'production') {
          console.warn('Presence update was not accepted:', presenceError.code);
        }
      } catch {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('Presence update failed.');
        }
      } finally {
        isSyncing = false;
      }
    };

    void syncPresence();
    const interval = window.setInterval(() => void syncPresence(), 60_000);
    const handlePageHide = () => {
      void updateCurrentUserPresence(supabase, false);
    };
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('pagehide', handlePageHide);
      void updateCurrentUserPresence(supabase, false);
    };
  }, []);

  return <>{children}</>;
}
