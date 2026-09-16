'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, RefreshCw, HelpCircle } from 'lucide-react';

function AuthErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  const getFriendlyMessage = () => {
    if (errorDescription) {
      return errorDescription;
    }
    if (error === 'access_denied') {
      return 'The authorization request was cancelled or denied. Please try again.';
    }
    if (error === 'server_error') {
      return 'The authentication provider encountered a temporary issue. Please try again in a few moments.';
    }
    return 'We could not verify your login request or the authentication link has expired. Please try signing in again.';
  };

  return (
    <div className="w-full max-w-md mx-auto p-6 sm:p-8 bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] rounded-2xl shadow-xl text-center">
      <div className="w-14 h-14 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-500/20">
        <AlertCircle className="w-8 h-8" />
      </div>
      <h1 className="text-xl font-bold mb-2 text-slate-900 dark:text-white">Authentication Failed</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
        {getFriendlyMessage()}
      </p>

      {error && (
        <div className="mb-6 px-3 py-2 bg-slate-100 dark:bg-slate-800/50 rounded-lg text-xs font-mono text-slate-600 dark:text-slate-400 break-all">
          Code: {error}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <Link
          href="/login"
          className="inline-flex items-center justify-center gap-2 flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-xl text-sm transition shadow-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Return to Login</span>
        </Link>
        <Link
          href="/"
          className="inline-flex items-center justify-center gap-2 flex-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium py-2.5 px-4 rounded-xl text-sm transition"
        >
          <span>Go Home</span>
        </Link>
      </div>
    </div>
  );
}

export default function AuthCodeErrorPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#07090e] text-slate-900 dark:text-slate-100 flex items-center justify-center p-4">
      <Suspense fallback={
        <div className="w-full max-w-md mx-auto p-8 text-center text-slate-500">
          Loading error details...
        </div>
      }>
        <AuthErrorContent />
      </Suspense>
    </div>
  );
}

