"use client";

import React, { useState, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';
import { ShieldCheck, UserCheck, AlertTriangle, UploadCloud, ExternalLink, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { KYCVerifyButton } from '@/components/KYCVerifyButton';

export default function IdentitySettingsPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [uploadingDp, setUploadingDp] = useState(false);
  const [avatarKey, setAvatarKey] = useState<number>(Date.now());
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const DIDIT_URL = "https://verify.didit.me/u/s2rBqin8QnKJOcHRhNBy_Q";

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
        setProfile(data);
      }
    } catch (err) {
      console.error('Error loading profile:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDpChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files || e.target.files.length === 0) return;
    setUploadingDp(true);
    setToastMessage(null);
    const file = e.target.files[0];

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/user/profile/avatar', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        setAvatarKey(Date.now());
        await loadProfile();
        setToastMessage({ type: 'success', text: 'Profile picture updated successfully.' });
      } else {
        const data = await res.json().catch(() => ({}));
        setToastMessage({ type: 'error', text: data.error || 'Failed to update Profile Picture.' });
      }
    } catch (err) {
      setToastMessage({ type: 'error', text: 'Error uploading image.' });
    } finally {
      setUploadingDp(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto p-6 space-y-4">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-800 rounded w-1/3"></div>
          <div className="h-32 bg-slate-800 rounded-xl"></div>
          <div className="h-48 bg-slate-800 rounded-xl"></div>
        </div>
      </div>
    );
  }

  const totalTraded = Number(profile?.total_traded_usd || 0.0);
  const isVerified = profile?.kyc_status === 'APPROVED';

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-8 text-white">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/settings" className="text-slate-400 hover:text-slate-200 transition text-sm flex items-center gap-1">
              <ArrowLeft className="w-4 h-4" /> Settings
            </Link>
          </div>
          <h1 className="text-2xl font-bold">Identity & Verification</h1>
        </div>
      </div>

      {toastMessage && (
        <div
          className={`p-3 rounded-lg text-xs flex items-center gap-2 border ${
            toastMessage.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}
        >
          {toastMessage.text}
        </div>
      )}

      {/* 1. Profile Picture Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col sm:flex-row items-center sm:items-start gap-6">
        <div className="relative">
          <img
            src={`/api/media/avatar/${profile?.id}?t=${avatarKey}`}
            alt="User DP"
            className="w-20 h-20 rounded-full object-cover border-2 border-emerald-500/30 bg-slate-800"
            onError={(e) => {
              // fallback gracefully
              (e.target as HTMLImageElement).src = `https://api.dicebear.com/7.x/identicon/svg?seed=${profile?.id || 'user'}`;
            }}
          />
        </div>
        <div className="flex-1 text-center sm:text-left">
          <h2 className="font-semibold text-lg flex items-center justify-center sm:justify-start gap-2">
            <UserCheck className="w-5 h-5 text-emerald-400" /> Profile Picture (DP)
          </h2>
          <p className="text-xs text-slate-400 mb-3 mt-1">
            Publicly visible across ads, trade chats, and your user profile.
          </p>
          <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-lg border border-slate-700 text-emerald-400 transition shadow-xs">
            <UploadCloud className="w-4 h-4" />
            {uploadingDp ? 'Uploading to B2...' : 'Change DP'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleDpChange}
              disabled={uploadingDp}
            />
          </label>
        </div>
      </div>

      {/* 2. KYC Verification & Trading Limits Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="font-semibold text-lg flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" /> KYC Verification
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Powered by Didit Identity Verification</p>
          </div>
          <span
            className={`px-3 py-1 text-xs font-bold rounded-full ${
              isVerified
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
            }`}
          >
            {isVerified ? '✓ Verified' : profile?.kyc_status || 'Not Verified'}
          </span>
        </div>

        {/* Progress & Limits */}
        <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 space-y-2">
          <div className="flex justify-between text-xs font-medium">
            <span className="text-slate-400">Trading Volume Limit:</span>
            <span>{isVerified ? 'No platform-imposed limit' : `$${totalTraded.toFixed(2)} / $1,000.00 USD`}</span>
          </div>
          {!isVerified && (
            <div className="w-full bg-slate-800 rounded-full h-2">
              <div
                className="bg-emerald-400 h-2 rounded-full transition-all"
                style={{ width: `${Math.min((totalTraded / 1000) * 100, 100)}%` }}
              />
            </div>
          )}
        </div>

        {!isVerified && (
          <div className="pt-2 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <KYCVerifyButton
                userId={profile?.id || ''}
                initialStatus={profile?.kyc_status || 'NOT_STARTED'}
                initialAttempts={profile?.kyc_attempts ?? 0}
                onSuccess={() => {
                  loadProfile();
                  setToastMessage({ type: 'success', text: 'Verification completed! Processing status...' });
                }}
              />
              <a
                href={`${DIDIT_URL}?client_reference_id=${profile?.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs rounded-lg border border-slate-700 transition"
              >
                Open in new tab <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
              </a>
            </div>
            <p className="text-[11px] text-slate-400">
              Unverified accounts are limited to $1,000 in total cumulative trades. Verification is instant and unlocks unlimited volume.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
