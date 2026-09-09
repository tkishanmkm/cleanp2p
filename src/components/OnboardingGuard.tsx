'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ShieldCheck, AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

interface OnboardingGuardProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export default function OnboardingGuard({ children, fallback }: OnboardingGuardProps) {
  const [checking, setChecking] = useState(true);
  const [isAllowed, setIsAllowed] = useState(true);
  const [guardReason, setGuardReason] = useState<string | null>(null);

  useEffect(() => {
    async function checkUserOnboarding() {
      try {
        const { data: { user }, error: authErr } = await supabase.auth.getUser();
        if (authErr || !user) {
          setIsAllowed(false);
          setGuardReason('auth_required');
          setChecking(false);
          return;
        }

        // Fetch user profile to verify status
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_banned, kyc_status, is_verified, is_suspended')
          .eq('id', user.id)
          .single();

        if (profile?.is_banned || profile?.is_suspended) {
          setIsAllowed(false);
          setGuardReason('account_suspended');
          setChecking(false);
          return;
        }

        // User is authenticated and active
        setIsAllowed(true);
      } catch (err) {
        console.warn('OnboardingGuard status check:', err);
        setIsAllowed(true);
      } finally {
        setChecking(false);
      }
    }

    checkUserOnboarding();
  }, []);

  if (checking) {
    return (
      <div className="flex items-center justify-center p-12 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2 text-emerald-500" />
        <span>Verifying account credentials...</span>
      </div>
    );
  }

  if (!isAllowed) {
    if (fallback) return <>{fallback}</>;

    if (guardReason === 'account_suspended') {
      return (
        <div className="max-w-xl mx-auto my-12 p-6 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-200">
          <div className="flex items-center gap-3 mb-2">
            <AlertCircle className="w-6 h-6 text-rose-400" />
            <h2 className="text-lg font-bold">Account Access Restricted</h2>
          </div>
          <p className="text-sm text-rose-300 mb-4">
            Your account is currently restricted from participating in active P2P trade rooms. Please contact support.
          </p>
          <Link
            href="/support"
            className="inline-flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold rounded-lg transition"
          >
            Contact Support <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      );
    }

    return (
      <div className="max-w-xl mx-auto my-12 p-6 rounded-xl bg-slate-900 border border-slate-800 text-slate-200">
        <div className="flex items-center gap-3 mb-2">
          <ShieldCheck className="w-6 h-6 text-emerald-400" />
          <h2 className="text-lg font-bold">Sign In Required</h2>
        </div>
        <p className="text-sm text-slate-400 mb-4">
          Please authenticate with your secure account to access this P2P escrow trade session.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg transition"
        >
          Sign In Now <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
