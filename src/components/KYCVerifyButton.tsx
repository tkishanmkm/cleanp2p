'use client';

import React, { useState } from 'react';
import Link from 'next/link';

export type KYCStatus =
  | 'NOT_STARTED'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'DECLINED'
  | 'RESUBMIT_REQUIRED'
  | 'SUPPORT_REQUIRED'
  | 'EXPIRED'
  | string;

export interface KYCVerifyButtonProps {
  userId: string;
  initialStatus?: KYCStatus;
  initialAttempts?: number;
  onSuccess?: () => void;
  className?: string;
  buttonText?: string;
}

export function KYCVerifyButton({
  userId,
  initialStatus = 'NOT_STARTED',
  initialAttempts = 0,
  onSuccess,
  className,
  buttonText: customButtonText,
}: KYCVerifyButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>(initialStatus);
  const [attempts, setAttempts] = useState<number>(initialAttempts);

  React.useEffect(() => {
    if (initialStatus) setStatus(initialStatus);
  }, [initialStatus]);

  React.useEffect(() => {
    if (typeof initialAttempts === 'number') setAttempts(initialAttempts);
  }, [initialAttempts]);

  const startVerification = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (
          response.status === 403 &&
          (data.code === 'max_attempts_exceeded' || data.error === 'max_attempts_exceeded')
        ) {
          setStatus('SUPPORT_REQUIRED');
          throw new Error('Maximum verification attempts exceeded. Please contact support.');
        }
        throw new Error(data.message || 'Failed to start verification session.');
      }

      // Launch Didit modal if supported; fallback to redirection
      const sessionUrl = data.sessionUrl || data.url;
      if (sessionUrl) {
        try {
          const { DiditSdk } = await import('@didit-protocol/sdk-web');
          if (DiditSdk?.shared) {
            DiditSdk.shared.onComplete = (result: any) => {
              if (result?.status === 'completed') {
                setStatus('PENDING_REVIEW');
                if (onSuccess) onSuccess();
              }
            };
            DiditSdk.shared.startVerification({ url: sessionUrl });
            return;
          }
        } catch (sdkErr) {
          console.warn('Didit Web SDK modal fallback to redirect:', sdkErr);
        }

        // Redirect user to the Didit verification URL
        window.location.href = sessionUrl;
      } else {
        throw new Error('No session URL returned.');
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  // State: Support Required (Reached 3 attempts or manually flagged)
  if (status === 'SUPPORT_REQUIRED' || attempts >= 3) {
    return (
      <div className="p-4 border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800/60 rounded-lg text-center space-y-3">
        <p className="text-red-700 dark:text-red-400 font-medium">
          You have reached the maximum number of KYC verification attempts ({attempts}/3).
        </p>
        <p className="text-sm text-red-600 dark:text-red-300">
          Manual identity verification is required by our compliance team.
        </p>
        <Link
          href="/support?reason=kyc_limit_exceeded"
          className="inline-block px-4 py-2 bg-red-600 text-white font-semibold rounded hover:bg-red-700 transition text-sm"
        >
          Contact Support
        </Link>
      </div>
    );
  }

  // State: Approved
  if (status === 'APPROVED') {
    return (
      <div className="flex items-center space-x-2 text-green-600 dark:text-green-400 font-medium p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800/60 rounded-lg text-sm">
        <svg className="w-5 h-5 fill-current flex-shrink-0" viewBox="0 0 20 20">
          <path d="M10 0C4.48 0 0 4.48 0 10s4.48 10 10 10 10-4.48 10-10S15.52 0 10 0zm-2 15l-5-5 1.41-1.41L8 12.17l7.59-7.59L17 6l-9 9z" />
        </svg>
        <span>Identity Verified</span>
      </div>
    );
  }

  // State: Pending Review
  if (status === 'PENDING_REVIEW') {
    return (
      <div className="p-3 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800/60 text-yellow-800 dark:text-yellow-300 rounded-lg text-center font-medium text-sm">
        Verification Pending Review. Check back shortly.
      </div>
    );
  }

  // State: Retry / First Attempt
  const defaultButtonText =
    status === 'RESUBMIT_REQUIRED' || status === 'DECLINED'
      ? `Retry Verification (Attempt ${attempts + 1} of 3)`
      : 'Start Identity Verification';

  const buttonText = customButtonText || defaultButtonText;

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button
        onClick={startVerification}
        disabled={loading}
        className={
          className ||
          "w-full px-4 py-2 bg-blue-600 text-white font-semibold rounded hover:bg-blue-700 disabled:opacity-50 transition cursor-pointer text-sm"
        }
      >
        {loading ? 'Initializing...' : buttonText}
      </button>
      {attempts > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
          Remaining attempts: {Math.max(0, 3 - attempts)}
        </p>
      )}
    </div>
  );
}

export default KYCVerifyButton;
