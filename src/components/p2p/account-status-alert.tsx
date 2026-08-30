'use client';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Ban, PauseCircle } from 'lucide-react';
import type { User } from '@/lib/types';
import Link from 'next/link';

export function AccountStatusAlert({ user }: { user: User }) {
  if (user.isBanned) {
    return (
      <Alert variant="destructive">
        <Ban className="h-4 w-4" />
        <AlertTitle>Account Banned</AlertTitle>
        <AlertDescription>
          Your account has been banned. All trading functionalities, including creating ads and depositing, have been disabled. You are only permitted to <Link href="/wallets" className="underline font-semibold">withdraw your existing funds</Link>.
        </AlertDescription>
      </Alert>
    );
  }
  if (user.isOnHold) {
    return (
      <Alert variant="default" className="border-yellow-500 text-yellow-800 dark:text-yellow-400 dark:bg-yellow-950">
        <PauseCircle className="h-4 w-4" />
        <AlertTitle>Account On Hold</AlertTitle>
        <AlertDescription>
          Your account is currently on hold. Trading, creating ads, and depositing are temporarily disabled. Please contact support if you believe this is an error.
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}
