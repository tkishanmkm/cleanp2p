'use client';

import React, { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { SupportForm } from '@/components/support/support-form';
import { LifeBuoy, Clock, ShieldAlert, CheckCircle2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

function SupportContent() {
  const searchParams = useSearchParams();
  const reason = searchParams.get('reason');
  const isKycIssue = reason === 'kyc_limit_exceeded';

  const [submitted, setSubmitted] = useState(false);
  const [subject, setSubject] = useState(
    isKycIssue ? 'KYC Manual Review Request' : 'General Inquiry'
  );
  const [message, setMessage] = useState(
    isKycIssue
      ? 'My identity verification failed after 3 attempts. Please assist with manual KYC review.'
      : ''
  );
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    // Simulate / execute support dispatch
    try {
      await new Promise((resolve) => setTimeout(resolve, 600));
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="max-w-md mx-auto my-12 p-8 bg-green-50 dark:bg-emerald-950/30 border border-green-200 dark:border-emerald-800/60 rounded-2xl text-center space-y-3 shadow-lg">
        <div className="w-12 h-12 mx-auto rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-green-800 dark:text-green-300">
          Support Request Received
        </h2>
        <p className="text-sm text-green-700 dark:text-green-400 leading-relaxed">
          Our compliance team will review your request and contact you via email within 24 hours.
        </p>
        <div className="pt-2">
          <Link
            href="/settings/identity"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Return to Identity Settings
          </Link>
        </div>
      </div>
    );
  }

  // If KYC limit was exceeded, render the dedicated compliance review request form
  if (isKycIssue) {
    return (
      <div className="max-w-md mx-auto my-8 p-6 sm:p-8 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl bg-white dark:bg-slate-900 space-y-5">
        <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-500">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Contact Compliance Support</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Manual review request for KYC verification</p>
          </div>
        </div>

        <div className="p-3.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-xl text-xs text-red-700 dark:text-red-300 leading-relaxed">
          You have reached the maximum automated verification attempts (3/3). Please submit this form to initiate manual review with our compliance officers.
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1.5">
              Subject
            </label>
            <input
              type="text"
              readOnly={isKycIssue}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full border border-slate-300 dark:border-slate-700 rounded-lg px-3.5 py-2.5 bg-gray-50 dark:bg-slate-800 text-gray-700 dark:text-gray-200 text-sm font-medium"
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1.5">
              Message
            </label>
            <textarea
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
              className="w-full border border-slate-300 dark:border-slate-700 rounded-lg px-3.5 py-2.5 text-gray-900 dark:text-white bg-white dark:bg-slate-950 focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition disabled:opacity-50 text-sm cursor-pointer shadow-md"
          >
            {submitting ? 'Submitting...' : 'Submit Ticket'}
          </button>
        </form>
      </div>
    );
  }

  // Standard Support Desk view
  return (
    <div className="space-y-6 max-w-4xl mx-auto py-4">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-[#9273FC] via-[#6366F1] to-[#3B82F6] text-white p-6 sm:p-8 rounded-2xl shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-xs font-medium text-white mb-2">
              <LifeBuoy className="w-3.5 h-3.5" />
              <span>24/7 Platform Assistance</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Customer Support</h1>
            <p className="text-white/80 text-sm mt-1 max-w-xl">
              Need assistance with an escrow trade, deposit, or account verification? Our support team is here to help.
            </p>
          </div>
          <div className="flex sm:flex-col items-start sm:items-end gap-2 text-xs text-white/90">
            <div className="flex items-center gap-1.5 bg-black/10 px-3 py-1.5 rounded-lg">
              <Clock className="w-4 h-4 text-emerald-300" />
              <span>Avg. response: &lt; 15 mins</span>
            </div>
          </div>
        </div>
      </div>

      <SupportForm />
    </div>
  );
}

export default function SupportPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[40vh] flex items-center justify-center text-sm text-slate-400">
          Loading support portal...
        </div>
      }
    >
      <SupportContent />
    </Suspense>
  );
}
