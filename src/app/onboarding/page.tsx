'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import OnboardingForm from '@/components/onboarding-form';
import { Loader2 } from 'lucide-react';
import { ModeToggle } from '@/components/mode-toggle';

export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState<{
    id: string;
    email: string;
    username: string;
    fullName?: string;
  } | null>(null);

  useEffect(() => {
    async function loadUser() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          router.push('/login');
          return;
        }

        const { data: profile } = await supabase
          .from('profiles')
          .select('id, username, display_name, full_name, name, onboarding_completed, dob, date_of_birth, security_question')
          .eq('id', user.id)
          .maybeSingle();

        // If already completed onboarding, redirect to /wallets
        if (profile?.onboarding_completed && (profile?.dob || profile?.date_of_birth) && profile?.security_question) {
          router.push('/wallets');
          return;
        }

        const resolvedUsername = profile?.username || profile?.display_name || user.user_metadata?.username || `user_${user.id.substring(0, 8)}`;
        const resolvedFullName = profile?.full_name || profile?.name || user.user_metadata?.full_name || user.user_metadata?.name || '';

        setUserData({
          id: user.id,
          email: user.email || '',
          username: resolvedUsername,
          fullName: resolvedFullName,
        });
      } catch (err) {
        console.error('Failed to load user for onboarding:', err);
      } finally {
        setLoading(false);
      }
    }

    loadUser();
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-[#6347ea]" />
      </div>
    );
  }

  if (!userData) {
    return null;
  }

  return (
    <div className="relative min-h-screen bg-slate-50 dark:bg-[#07090e] text-slate-900 dark:text-slate-100 flex items-center justify-center p-4">
      <div className="absolute top-4 right-4 z-10">
        <ModeToggle />
      </div>
      <div className="w-full max-w-xl">
        <OnboardingForm user={userData} />
      </div>
    </div>
  );
}
