"use client";

import React, { useState, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';
import Link from 'next/link';
import {
  User,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Loader2,
  Eye,
  DollarSign,
  Settings as SettingsIcon,
  ChevronRight,
} from 'lucide-react';
import { ChangePasswordForm } from '@/components/settings/change-password-form';
import { SessionManagement } from '@/components/settings/session-management';

export default function SettingsPage() {
  const supabase = createClient();

  const [profile, setProfile] = useState<{
    id?: string;
    username?: string;
    username_changed_count?: number;
    full_name?: string;
    name_visibility?: string;
    preferred_currency?: string;
  } | null>(null);

  const [newUsername, setNewUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [nameVisibility, setNameVisibility] = useState('FULL_NAME');
  const [preferredCurrency, setPreferredCurrency] = useState('USD');

  const [loading, setLoading] = useState(true);
  const [submittingUsername, setSubmittingUsername] = useState(false);
  const [submittingSettings, setSubmittingSettings] = useState(false);

  const [usernameMessage, setUsernameMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [settingsMessage, setSettingsMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Fetch current user profile on load
  useEffect(() => {
    async function fetchProfile() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data, error } = await supabase
          .from('profiles')
          .select('id, username, username_changed_count, full_name, name_visibility, preferred_currency')
          .eq('id', user.id)
          .single();

        if (error) {
          console.error('Error fetching profile:', error);
          return;
        }

        if (data) {
          setProfile(data);
          setNewUsername(data.username || '');
          setFullName(data.full_name || '');
          setNameVisibility(data.name_visibility || 'FULL_NAME');
          setPreferredCurrency(data.preferred_currency || 'USD');
        }
      } catch (err: any) {
        console.error('Error fetching profile:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchProfile();
  }, [supabase]);

  const handleUsernameUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setUsernameMessage(null);

    // Sanitize input: only alphanumeric and underscores
    const cleanUsername = newUsername.trim().replace(/[^a-zA-Z0-9_]/g, '');

    if (cleanUsername.length < 3) {
      setUsernameMessage({ type: 'error', text: 'Username must be at least 3 characters long.' });
      return;
    }

    if (cleanUsername.length > 30) {
      setUsernameMessage({ type: 'error', text: 'Username cannot exceed 30 characters.' });
      return;
    }

    if (profile && cleanUsername.toLowerCase() === profile.username?.toLowerCase()) {
      setUsernameMessage({ type: 'error', text: 'Please enter a new username different from your current handle.' });
      return;
    }

    setSubmittingUsername(true);

    try {
      const response = await fetch('/api/user/update-username', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newUsername: cleanUsername }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update username');
      }

      // Update local state upon success
      setProfile((prev: any) => ({
        ...prev,
        username: result.username,
        username_changed_count: (prev?.username_changed_count || 0) + 1,
      }));

      setUsernameMessage({
        type: 'success',
        text: `Username successfully updated to @${result.username}! You have used your one-time username change.`,
      });
    } catch (err: any) {
      setUsernameMessage({ type: 'error', text: err.message || 'An unexpected error occurred.' });
    } finally {
      setSubmittingUsername(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsMessage(null);
    setSubmittingSettings(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Unauthorized');

      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          name_visibility: nameVisibility,
          preferred_currency: preferredCurrency,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (error) throw error;

      setProfile((prev: any) => ({
        ...prev,
        full_name: fullName.trim(),
        name_visibility: nameVisibility,
        preferred_currency: preferredCurrency,
      }));

      setSettingsMessage({
        type: 'success',
        text: 'Settings updated successfully! Changes will apply to your future trades.',
      });
    } catch (err: any) {
      setSettingsMessage({ type: 'error', text: err.message || 'Failed to save settings.' });
    } finally {
      setSubmittingSettings(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  const isLocked = (profile?.username_changed_count || 0) >= 1;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Page Title Header */}
      <div className="space-y-1.5 border-b border-border/40 pb-5">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-500">
            <SettingsIcon className="h-4 w-4" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
            Account Settings & Privacy
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Manage your trader handle, real display name visibility, and platform preferences.
        </p>
      </div>

      {/* Identity, DP & KYC Verification Quick Access */}
      <Link
        href="/settings/identity"
        className="block rounded-2xl bg-gradient-to-r from-emerald-950/40 via-slate-900 to-slate-900 border border-emerald-500/30 p-5 hover:border-emerald-500/60 transition group shadow-lg"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition-transform">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Identity & KYC Verification
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Didit Verified
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Update your Profile Picture (DP), unlock unlimited volume, and verify identity.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400 group-hover:translate-x-0.5 transition-transform">
            <span>Manage</span>
            <ChevronRight className="w-4 h-4" />
          </div>
        </div>
      </Link>

      {/* 1. Platform User Handle Management Card */}
      <div className="rounded-3xl bg-slate-900 border border-slate-800 p-6 sm:p-8 shadow-2xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
            <User className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Platform User Handle</h2>
            <p className="text-xs text-slate-400">Your unique @username visible across all trading and ad pages</p>
          </div>
        </div>

        {/* Feedback Alert Messages */}
        {usernameMessage && (
          <div
            className={`p-4 rounded-xl border flex items-start gap-3 text-sm ${
              usernameMessage.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}
          >
            {usernameMessage.type === 'success' ? (
              <CheckCircle2 className="h-5 w-5 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            )}
            <p className="text-xs font-semibold leading-relaxed">{usernameMessage.text}</p>
          </div>
        )}

        <form onSubmit={handleUsernameUpdate} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
              <span>Username</span>
              <span className={`text-[11px] font-mono px-2 py-0.5 rounded-md ${
                isLocked ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
              }`}>
                {isLocked ? '0 changes remaining' : '1 change remaining'}
              </span>
            </label>

            <div className="relative">
              <span className="absolute left-3.5 top-3.5 text-slate-500 font-mono font-bold text-sm">@</span>
              <input
                type="text"
                disabled={isLocked || submittingUsername}
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="enter_new_username"
                className={`w-full pl-9 pr-4 py-3 rounded-xl bg-slate-950 border text-white font-mono text-sm transition-all focus:outline-none ${
                  isLocked
                    ? 'border-slate-800 text-slate-500 cursor-not-allowed opacity-60'
                    : 'border-slate-800 focus:border-indigo-500'
                }`}
              />
            </div>
          </div>

          {/* Rule Guidance Banner */}
          {isLocked ? (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-950 border border-slate-800/80 text-amber-400/90 text-xs">
              <ShieldAlert className="h-4 w-4 flex-shrink-0" />
              <span>You have already used your one-time username modification. Your handle is permanently locked.</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-indigo-950/40 border border-indigo-800/30 text-indigo-300 text-xs">
              <Sparkles className="h-4 w-4 flex-shrink-0 text-indigo-400" />
              <span>You can modify your auto-generated username exactly <strong>once</strong>. Choose carefully!</span>
            </div>
          )}

          {!isLocked && (
            <button
              type="submit"
              disabled={submittingUsername}
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold text-sm shadow-lg shadow-indigo-600/25 hover:from-indigo-500 hover:to-violet-500 transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {submittingUsername && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Username
            </button>
          )}
        </form>
      </div>

      {/* 2. Display Name & Privacy Settings Card */}
      <div className="rounded-3xl bg-slate-900 border border-slate-800 p-6 sm:p-8 shadow-2xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
            <Eye className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Display Name & Privacy Settings</h2>
            <p className="text-xs text-slate-400">Control how your real name appears in Trade Chat ⓘ Info sections</p>
          </div>
        </div>

        {settingsMessage && (
          <div
            className={`p-4 rounded-xl border flex items-start gap-3 text-sm ${
              settingsMessage.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}
          >
            {settingsMessage.type === 'success' ? (
              <CheckCircle2 className="h-5 w-5 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            )}
            <p className="text-xs font-semibold leading-relaxed">{settingsMessage.text}</p>
          </div>
        )}

        <form onSubmit={handleSaveSettings} className="space-y-6">
          {/* Real Full Name Input */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300">Full Name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Adam Dam"
              className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Visibility Rule Options */}
          <div className="space-y-3">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-2">
              <Eye className="h-4 w-4 text-indigo-400" /> Name Visibility in Trade Chat
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { key: 'FULL_NAME', label: 'Full Name', example: fullName || 'Adam Dam' },
                {
                  key: 'PARTIAL_NAME',
                  label: 'Partial Name',
                  example: fullName
                    ? `${fullName.charAt(0)}. ${fullName.split(' ').slice(-1)[0] || ''}`
                    : 'A. Dam',
                },
                { key: 'HIDE_NAME', label: 'Hide Name', example: 'No name displayed' },
              ].map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setNameVisibility(opt.key)}
                  className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                    nameVisibility === opt.key
                      ? 'bg-indigo-600/20 border-indigo-500 text-white'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <p className="text-xs font-bold">{opt.label}</p>
                  <p className="text-[11px] text-slate-500 mt-1 font-mono">{opt.example}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Preferred Currency */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-emerald-400" /> Default Display Currency
            </label>
            <select
              value={preferredCurrency}
              onChange={(e) => setPreferredCurrency(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              {['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'AED', 'BRL'].map((curr) => (
                <option key={curr} value={curr} className="bg-slate-900 text-white">
                  {curr}
                </option>
              ))}
            </select>
          </div>

          {/* Guidance Banner */}
          <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-950 border border-slate-800/80 text-indigo-300 text-xs">
            <Sparkles className="h-4 w-4 flex-shrink-0 text-indigo-400" />
            <span>
              Changing visibility settings will apply to <strong>new trades</strong>. Running trades retain their initial snapshot name.
            </span>
          </div>

          <button
            type="submit"
            disabled={submittingSettings}
            className="px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold text-sm shadow-lg shadow-indigo-600/25 hover:from-indigo-500 hover:to-violet-500 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {submittingSettings && <Loader2 className="h-4 w-4 animate-spin" />}
            Save Settings
          </button>
        </form>
      </div>

      {/* 3. Account Security & Password */}
      <ChangePasswordForm />

      {/* 4. Active Sessions */}
      <SessionManagement />
    </div>
  );
}
