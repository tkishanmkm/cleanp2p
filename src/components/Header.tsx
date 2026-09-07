'use client';

import React, { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { getPublicHandle } from '@/utils/userPrivacy';
import Link from 'next/link';

export default function Header() {
  const [profileHandle, setProfileHandle] = useState<string>('@pulsepost949');

  useEffect(() => {
    async function loadHeaderUser() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', user.id)
          .maybeSingle();

        if (profile?.username) {
          setProfileHandle(getPublicHandle(profile.username));
        }
      }
    }

    loadHeaderUser();
  }, []);

  return (
    <div className="flex items-center gap-2">
      <Link 
        href={`/user/${profileHandle.replace('@', '')}`}
        className="font-bold text-sm text-foreground hover:underline"
      >
        {profileHandle}
      </Link>
    </div>
  );
}
