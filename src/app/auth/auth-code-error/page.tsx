import Link from 'next/link';
import { AlertCircle, ArrowLeft } from 'lucide-react';

export const metadata = {
  title: 'Authentication Error | Paxones',
  description: 'An error occurred during authentication.',
};

export default function AuthCodeErrorPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#07090e] text-slate-900 dark:text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md mx-auto p-6 sm:p-8 bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] rounded-2xl shadow-xl text-center">
        <div className="w-14 h-14 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-500/20">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h1 className="text-xl font-bold mb-2">Authentication Failed</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
          We could not verify your login request or the authentication code has expired. Please try signing in again.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center justify-center gap-2 w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-xl text-sm transition shadow-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Return to Login</span>
        </Link>
      </div>
    </div>
  );
}
