'use client';

import { ProfileSettings } from '@/components/settings/profile-settings';
import { ChangeUsernameForm } from '@/components/settings/change-username-form';
import { ChangePasswordForm } from '@/components/settings/change-password-form';
import { ChangeCurrencyForm } from '@/components/settings/change-currency-form';
import { ChangeCountryForm } from '@/components/settings/change-country-form';
import { SessionManagement } from '@/components/settings/session-management';
import { BlockedUsersManagement } from '@/components/settings/blocked-users-management';
import { useAuth } from '@/components/providers/auth-provider';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { User } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';

export default function SettingsPage() {
  const { user: authUser, profile, isUserLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isUserLoading && !authUser) {
      router.push('/login');
    }
  }, [authUser, isUserLoading, router]);

  if (isUserLoading || !authUser || !profile) {
    return (
      <>
        <div className="flex items-center mb-6">
          <h1 className="text-lg font-semibold md:text-2xl">Settings</h1>
        </div>
        <div className="max-w-3xl mx-auto space-y-8">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </>
    );
  }

  const userData: User = {
    id: profile.id,
    userId: profile.username || profile.id,
    username: profile.username,
    email: profile.email,
    photoURL: profile.photoURL,
    country: profile.country,
    preferredCurrency: profile.preferredCurrency,
    isAdminAccount: profile.isAdminAccount,
    isSuspended: profile.isSuspended,
    usernameChanged: profile.usernameChanged,
    blockedUsers: profile.blockedUsers || [],
    feedbackScore: profile.feedbackScore || 100,
    completedTrades: profile.completedTrades || 0,
    createdAt: profile.createdAt || new Date().toISOString(),
  };

  return (
    <>
      <div className="flex items-center mb-6">
        <h1 className="text-lg font-semibold md:text-2xl">Settings</h1>
      </div>
      <div className="max-w-3xl mx-auto space-y-8">
        <ProfileSettings user={userData} />
        <ChangeUsernameForm user={userData} />
        <ChangePasswordForm />
        <ChangeCountryForm user={userData} />
        <ChangeCurrencyForm user={userData} />
        <SessionManagement />
        <BlockedUsersManagement user={userData} />
      </div>
    </>
  );
}
