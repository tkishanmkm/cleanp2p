'use client';

import { supabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

export function DiscordAuthButton() {
  const handleDiscordLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        redirectTo: `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback`,
      },
    });
  };

  return (
    <Button 
      type="button"
      onClick={handleDiscordLogin}
      variant="outline"
      className="w-full flex items-center justify-center gap-2 bg-[#5865F2] hover:bg-[#4752C4] text-white font-medium h-11 border-none shadow-sm transition"
    >
      <svg className="w-5 h-5 fill-current" viewBox="0 0 127.14 96.36">
        <path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a74.57 74.57 0 0 0 64.3 0c.87.68 1.76 1.36 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.88-72.14zM42.45 65.69c-6.31 0-11.5-5.79-11.5-12.87 0-7.08 5.07-12.87 11.5-12.87 6.47 0 11.62 5.82 11.5 12.87 0 7.08-5.03 12.87-11.5 12.87zm42.24 0c-6.31 0-11.5-5.79-11.5-12.87 0-7.08 5.07-12.87 11.5-12.87 6.47 0 11.62 5.82 11.5 12.87 0 7.08-5.03 12.87-11.5 12.87z"/>
      </svg>
      Continue with Discord
    </Button>
  );
}
