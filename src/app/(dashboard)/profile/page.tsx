'use client';

import React, { useState, useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useAuth } from '@/components/providers/auth-provider';

export default function PrivateProfilePage() {
  const supabase = createClientComponentClient();
  const { user: authContextUser, profile: contextProfile } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadPrivateProfile() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const activeUserId = user?.id || authContextUser?.id || authContextUser?.uid;

        if (!activeUserId) {
          // If no active auth user, check context profile
          if (contextProfile) {
            setProfile({
              username: contextProfile.username || 'user',
              full_name: contextProfile.full_name || 'Not provided',
              date_of_birth: contextProfile.dob || contextProfile.date_of_birth || 'Not provided',
              preferred_currency: contextProfile.preferred_currency || 'USD',
            });
            setStats({
              total_trade_volume: contextProfile.trade_volume || 0,
              completed_trades: contextProfile.completed_trades || 0,
              avg_payment_seconds: 240,
              avg_release_seconds: 120,
            });
          }
          setLoading(false);
          return;
        }

        // Fetch complete private profile
        const { data: prof } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', activeUserId)
          .maybeSingle();

        // Fetch private stats
        const { data: st } = await supabase
          .from('user_trading_stats')
          .select('*')
          .eq('user_id', activeUserId)
          .maybeSingle();

        const resolvedProfile = prof || {
          username: contextProfile?.username || user?.email?.split('@')[0] || 'user',
          full_name: contextProfile?.full_name || 'Not provided',
          date_of_birth: contextProfile?.dob || contextProfile?.date_of_birth || 'Not provided',
          preferred_currency: contextProfile?.preferred_currency || 'USD',
        };

        const resolvedStats = st || {
          total_trade_volume: resolvedProfile.total_trade_volume || resolvedProfile.trade_volume || 0,
          completed_trades: resolvedProfile.completed_trades || 0,
          avg_payment_seconds: (resolvedProfile.avg_payment_minutes || 4) * 60,
          avg_release_seconds: (resolvedProfile.avg_release_minutes || 2) * 60,
        };

        setProfile(resolvedProfile);
        setStats(resolvedStats);
      } catch (err) {
        console.warn('Error loading private profile:', err);
      } finally {
        setLoading(false);
      }
    }

    loadPrivateProfile();
  }, [supabase, authContextUser, contextProfile]);

  if (loading || !profile) {
    return (
      <div className="p-8 text-center text-gray-500">
        Loading profile...
      </div>
    );
  }

  const displayUsername = (profile.username || 'user').replace(/^@/, '');
  const initial = displayUsername.charAt(0).toUpperCase() || 'U';

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      {/* Header Info */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 flex items-center space-x-6">
        <div className="w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center text-2xl font-bold text-white shadow-sm">
          {initial}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">@{displayUsername}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Account Owner (Private View)</p>
        </div>
      </div>

      {/* Private Personal Credentials */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 space-y-4">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b pb-2 dark:border-gray-700">
          Private User Information
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
          <div>
            <p className="text-gray-500 dark:text-gray-400">Full Legal Name</p>
            <p className="font-medium text-gray-800 dark:text-gray-200">{profile.full_name || 'Not provided'}</p>
          </div>
          <div>
            <p className="text-gray-500 dark:text-gray-400">Date of Birth</p>
            <p className="font-medium text-gray-800 dark:text-gray-200">{profile.date_of_birth || profile.dob || 'Not provided'}</p>
          </div>
          <div>
            <p className="text-gray-500 dark:text-gray-400">Preferred Fiat Currency</p>
            <p className="font-medium text-gray-800 dark:text-gray-200">{profile.preferred_currency || 'USD'}</p>
          </div>
        </div>
      </div>

      {/* Trade Statistics Summary */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 space-y-4">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b pb-2 dark:border-gray-700">
          Trading Performance Summary
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
            <p className="text-gray-500 dark:text-gray-400">Total Volume</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">${Number(stats?.total_trade_volume || 0).toLocaleString()}</p>
          </div>
          <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
            <p className="text-gray-500 dark:text-gray-400">Completed Trades</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{stats?.completed_trades || 0}</p>
          </div>
          <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
            <p className="text-gray-500 dark:text-gray-400">Avg. Payment Time</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{Math.round((stats?.avg_payment_seconds || 0) / 60)} min</p>
          </div>
          <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
            <p className="text-gray-500 dark:text-gray-400">Avg. Release Time</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{Math.round((stats?.avg_release_seconds || 0) / 60)} min</p>
          </div>
        </div>
      </div>
    </div>
  );
}
