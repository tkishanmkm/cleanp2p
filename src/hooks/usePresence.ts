'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

export function usePresence(userId?: string) {
  const supabase = createClient();
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) return;

    const channel = supabase.channel('online-users', {
      config: { presence: { key: userId } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const activeIds = new Set<string>(Object.keys(state));
        setOnlineUsers(activeIds);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });

    // Pulse heartbeat every 2 minutes
    const interval = setInterval(async () => {
      try {
        await supabase
          .from('profiles')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('id', userId);
      } catch (err) {
        console.warn('Presence heartbeat error:', err);
      }
    }, 120000);

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [userId, supabase]);

  return { onlineUsers, isOnline: (id: string) => onlineUsers.has(id) };
}

export default usePresence;
