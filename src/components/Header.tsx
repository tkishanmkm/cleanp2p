'use client';

import React, { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { getPublicHandle } from '@/utils/userPrivacy';
import Link from 'next/link';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

export default function Header() {
  const [profileHandle, setProfileHandle] = useState<string>('@pulsepost949');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    async function loadHeaderUser() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('username, avatar_url, photo_url')
          .eq('id', user.id)
          .maybeSingle();

        if (profile?.username) {
          setProfileHandle(getPublicHandle(profile.username));
        }
        setAvatarUrl(profile?.avatar_url || profile?.photo_url || (user.user_metadata as any)?.avatar_url || null);
      }
    }

    loadHeaderUser();
  }, []);

  return (
    <div className="flex items-center gap-2">
      <Avatar className="h-7 w-7 rounded-full border border-border overflow-hidden bg-[#18181b]">
        {avatarUrl ? (
          <AvatarImage src={avatarUrl} alt="User Avatar" />
        ) : (
          <AvatarFallback className="bg-[#18181b] p-0.5">
            <img src="/default-avatar.svg" alt="Avatar" className="w-full h-full object-cover" />
          </AvatarFallback>
        )}
      </Avatar>
      <Link 
        href={`/users/${profileHandle.replace('@', '')}`}
        className="font-bold text-sm text-foreground hover:underline"
      >
        {profileHandle}
      </Link>
    </div>
  );
}
