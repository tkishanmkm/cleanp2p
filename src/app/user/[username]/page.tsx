'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { getPublicHandle } from '@/utils/userPrivacy';
import { Loader2 } from 'lucide-react';

export default function UserProfilePage() {
  const params = useParams();
  const rawParam = (params?.username || params?.userId) as string;
  const targetUsername = rawParam ? decodeURIComponent(rawParam).replace('@', '') : '';

  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchProfile() {
      if (!targetUsername) {
        setLoading(false);
        return;
      }
      setLoading(true);
      const supabase = createClient();

      // Query by username or id
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetUsername);
      let query = supabase
        .from('profiles')
        .select('id, username, is_online, last_seen, created_at');

      if (isUuid) {
        query = query.or(`username.eq.${targetUsername},id.eq.${targetUsername}`);
      } else {
        query = query.eq('username', targetUsername);
      }

      const { data, error } = await query.maybeSingle();

      if (data) {
        setProfile(data);
      }
      setLoading(false);
    }

    fetchProfile();
  }, [targetUsername]);

  if (loading) {
    return (
      <div className="p-12 text-center">
        <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
        <span className="text-xs text-muted-foreground mt-2 block">Loading user profile...</span>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center text-red-500 font-medium">
        User profile not found.
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-4">
      <div className="p-6 rounded-2xl border border-border bg-card">
        <h1 className="text-2xl font-bold text-foreground">
          {getPublicHandle(profile.username)}
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Status: {profile.is_online ? '🟢 Online' : '🔴 Offline'}
        </p>
      </div>
    </div>
  );
}
