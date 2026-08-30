'use client';

import { ProfileSettings } from "@/components/settings/profile-settings";
import { ChangeUsernameForm } from "@/components/settings/change-username-form";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { ChangeCurrencyForm } from "@/components/settings/change-currency-form";
import { ChangeCountryForm } from "@/components/settings/change-country-form";
import { SessionManagement } from "@/components/settings/session-management";
import { BlockedUsersManagement } from "@/components/settings/blocked-users-management";
import { useFirebase, useDoc, useMemoFirebase } from "@/firebase";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { doc } from "firebase/firestore";
import type { User } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsPage() {
  const { user: authUser, isUserLoading: isAuthLoading, firestore } = useFirebase();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthLoading && !authUser) {
      router.push('/login');
    }
  }, [authUser, isAuthLoading, router]);

  const userRef = useMemoFirebase(() => (authUser ? doc(firestore, "users", authUser.uid) : null), [firestore, authUser]);
  const { data: userData, isLoading: isUserDocLoading } = useDoc<User>(userRef);

  const isLoading = isAuthLoading || isUserDocLoading;

  if (isLoading || !authUser || !userData) {
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
