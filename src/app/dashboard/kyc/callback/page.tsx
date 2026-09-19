'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ShieldCheck, Clock, AlertTriangle, CheckCircle2, ArrowRight, RefreshCw, Home, Shield } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export default function KycCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setLoading(false);
        return;
      }

      const { data: prof, error: profErr } = await supabase
        .from('profiles')
        .select('id, username, full_name, kyc_status, id_verified, is_kyc_locked, kyc_retry_count, kyc_attempts')
        .eq('id', user.id)
        .single();

      if (profErr) throw profErr;
      setProfile(prof);
    } catch (err: any) {
      console.error('Failed to fetch profile status:', err);
      setError(err.message || 'Failed to retrieve verification status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();

    // Periodic poll for 30 seconds to catch fast webhooks
    const interval = setInterval(() => {
      fetchStatus();
    }, 5000);

    const timer = setTimeout(() => clearInterval(interval), 30000);

    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, []);

  const kycStatus = (profile?.kyc_status || 'in_review').toLowerCase();
  const isApproved = ['approved', 'verified'].includes(kycStatus) || Boolean(profile?.id_verified);
  const isUnderReview = ['in_review', 'pending', 'pending_review', 'submitted', 'under_review'].includes(kycStatus);
  const isDeclined = ['declined', 'rejected', 'failed'].includes(kycStatus);
  const isPermanentlyLocked = kycStatus === 'permanently_rejected' || (profile?.kyc_attempts >= 3) || (profile?.kyc_retry_count >= 3);

  return (
    <div id="kyc-callback-container" className="min-h-screen bg-background flex flex-col justify-center items-center p-4 sm:p-6">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-xl p-6 sm:p-8 text-center space-y-6">
        
        {loading ? (
          <div className="space-y-4 py-8">
            <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto animate-pulse">
              <RefreshCw className="w-8 h-8 animate-spin" />
            </div>
            <h2 className="text-xl font-bold text-foreground">Synchronizing Verification...</h2>
            <p className="text-sm text-muted-foreground">
              Please wait while we receive and synchronize your Didit KYC verification result.
            </p>
          </div>
        ) : isApproved ? (
          <div className="space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto border border-emerald-500/20">
              <ShieldCheck className="w-8 h-8" />
            </div>
            <div>
              <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20 mb-2">
                <CheckCircle2 className="w-3.5 h-3.5" /> Tier 2 Verified
              </span>
              <h1 className="text-2xl font-extrabold text-foreground">Verification Approved!</h1>
              <p className="text-sm text-muted-foreground mt-2">
                Your identity documents and biometric liveness checks have been verified. You now enjoy unlimited peer-to-peer trading and withdrawals.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-secondary/50 border border-border text-left space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Verification Tier</span>
                <span className="font-bold text-foreground">Tier 2 (Unlimited)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Compliance Status</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">Permanently Active</span>
              </div>
            </div>

            <div className="pt-2 flex flex-col gap-2.5">
              <Link
                href="/buy"
                className="w-full py-3 px-4 rounded-xl bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 hover:opacity-95 transition text-sm shadow-md"
              >
                Go to P2P Trading <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href="/settings/identity"
                className="w-full py-2.5 px-4 rounded-xl border border-border text-foreground font-medium hover:bg-secondary transition text-sm flex items-center justify-center gap-2"
              >
                View Identity Settings
              </Link>
            </div>
          </div>
        ) : isPermanentlyLocked ? (
          <div className="space-y-4">
            <div className="w-16 h-16 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto border border-rose-500/20">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <div>
              <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-500/10 px-3 py-1 rounded-full border border-rose-500/20 mb-2">
                24-Hour Limit Reached
              </span>
              <h1 className="text-2xl font-extrabold text-foreground">Verification Locked</h1>
              <p className="text-sm text-muted-foreground mt-2">
                You have reached the maximum allowed verification attempts (3/3 in 24 hours). Please contact our support team for manual verification assistance.
              </p>
            </div>

            <div className="pt-2 flex flex-col gap-2.5">
              <Link
                href="/support?reason=kyc_limit_exceeded"
                className="w-full py-3 px-4 rounded-xl bg-rose-600 text-white font-semibold flex items-center justify-center gap-2 hover:bg-rose-700 transition text-sm shadow-md"
              >
                Contact Support
              </Link>
              <Link
                href="/dashboard"
                className="w-full py-2.5 px-4 rounded-xl border border-border text-foreground font-medium hover:bg-secondary transition text-sm flex items-center justify-center gap-2"
              >
                <Home className="w-4 h-4" /> Return to Dashboard
              </Link>
            </div>
          </div>
        ) : isDeclined ? (
          <div className="space-y-4">
            <div className="w-16 h-16 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto border border-amber-500/20">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <div>
              <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20 mb-2">
                Verification Incomplete
              </span>
              <h1 className="text-2xl font-extrabold text-foreground">Verification Declined</h1>
              <p className="text-sm text-muted-foreground mt-2">
                We could not verify your identity documents or liveness check. Please ensure your document scan is clear, valid, and unexpired.
              </p>
            </div>

            <div className="p-3 rounded-xl bg-secondary/50 border border-border text-xs text-muted-foreground">
              Remaining Attempts (24h): {Math.max(0, 3 - (profile?.kyc_retry_count || profile?.kyc_attempts || 1))} of 3
            </div>

            <div className="pt-2 flex flex-col gap-2.5">
              <Link
                href="/settings/identity"
                className="w-full py-3 px-4 rounded-xl bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 hover:opacity-95 transition text-sm shadow-md"
              >
                Retry Verification
              </Link>
              <Link
                href="/support?reason=kyc_help"
                className="w-full py-2.5 px-4 rounded-xl border border-border text-foreground font-medium hover:bg-secondary transition text-sm flex items-center justify-center gap-2"
              >
                Contact Support
              </Link>
            </div>
          </div>
        ) : (
          /* Default: Under Review */
          <div className="space-y-4">
            <div className="w-16 h-16 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto border border-amber-500/20">
              <Clock className="w-8 h-8" />
            </div>
            <div>
              <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20 mb-2">
                <Clock className="w-3.5 h-3.5" /> Under Review
              </span>
              <h1 className="text-2xl font-extrabold text-foreground">Verification Under Review</h1>
              <p className="text-sm text-muted-foreground mt-2">
                Your Didit KYC verification has been submitted and is currently being processed by automated compliance checks.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-secondary/50 border border-border text-left space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Status</span>
                <span className="font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                  In Compliance Review
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Estimated Time</span>
                <span className="font-semibold text-foreground">1-5 minutes</span>
              </div>
            </div>

            <div className="pt-2 flex flex-col gap-2.5">
              <button
                onClick={fetchStatus}
                className="w-full py-3 px-4 rounded-xl bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 hover:opacity-95 transition text-sm shadow-md cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" /> Check Status Now
              </button>
              <Link
                href="/dashboard"
                className="w-full py-2.5 px-4 rounded-xl border border-border text-foreground font-medium hover:bg-secondary transition text-sm flex items-center justify-center gap-2"
              >
                <Home className="w-4 h-4" /> Continue to Dashboard
              </Link>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
