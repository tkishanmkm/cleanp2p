'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { getPublicHandle } from '@/utils/userPrivacy';
import { useI18n } from '@/context/i18n-context';
import { Loader2 } from 'lucide-react';

export default function UserProfilePage() {
  const { t } = useI18n();
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
      try {
        // Public profile reads go through a narrow server endpoint. The client role
        // intentionally has no SELECT grant on the sensitive profiles table.
        const response = await fetch(
          `/api/users/${encodeURIComponent(targetUsername)}`,
          { cache: 'no-store' }
        );
        if (response.ok) {
          const data = await response.json();
          if (data && typeof data.username === 'string') {
            setProfile({
              id: data.id,
              username: data.username.replace(/^@/, ''),
              is_online: Boolean(data.is_online),
              last_seen_at: data.last_seen_at || null,
              created_at: data.joined_at || null,
            });
          }
        }
      } catch (error) {
        console.error('Error loading public user profile:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchProfile();
  }, [targetUsername]);

  if (loading) {
    return (
      <div className="p-12 text-center">
        <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
        <span className="text-xs text-muted-foreground mt-2 block">{t('publicUserPage.loading')}</span>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center text-red-500 font-medium">
        {t('publicUserPage.notFound')}
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
          {t('publicUserPage.status')} {profile.is_online ? t('p2pAdCard.online') : t('p2pAdCard.offline')}
        </p>
      </div>
    </div>
  );
}
