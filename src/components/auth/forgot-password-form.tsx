'use client';

import React, { useState, useRef } from 'react';
import Link from 'next/link';
import { User, KeyRound, ShieldAlert, CheckCircle2, Loader2, ArrowLeft } from 'lucide-react';
import { UNIVERSAL_SECURITY_QUESTIONS } from '@/lib/settings-constants';
import { ResponsiveHCaptcha, ResponsiveHCaptchaRef } from '@/components/auth/responsive-hcaptcha';

export function ForgotPasswordForm() {
  const [identifier, setIdentifier] = useState('');
  const [securityQuestion, setSecurityQuestion] = useState(UNIVERSAL_SECURITY_QUESTIONS[0]);
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successInfo, setSuccessInfo] = useState<{ email: string; message: string } | null>(null);
  const captchaRef = useRef<ResponsiveHCaptchaRef>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!identifier.trim()) {
      setErrorMsg('Please enter your registered email address or username.');
      return;
    }

    if (!securityAnswer.trim()) {
      setErrorMsg('Please provide the security answer to authenticate your identity.');
      return;
    }

    if (!captchaToken) {
      setErrorMsg('Please complete the hCaptcha security verification box.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: identifier.trim(),
          securityQuestion,
          securityAnswer: securityAnswer.trim(),
          captchaToken,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to process password recovery request.');
      }

      setSuccessInfo({
        email: data.email,
        message: data.message,
      });
    } catch (err: any) {
      setErrorMsg(err.message || 'Password recovery failed. Please check your details.');
      setCaptchaToken('');
      captchaRef.current?.resetCaptcha();
    } finally {
      setLoading(false);
    }
  };

  if (successInfo) {
    return (
      <div className="text-center space-y-4 py-2">
        <div className="w-14 h-14 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto border border-emerald-500/20">
          <CheckCircle2 className="w-7 h-7" />
        </div>
        <h3 className="text-lg font-bold text-slate-900 dark:text-white">Reset Link Dispatched</h3>
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          {successInfo.message}
        </p>
        <div className="pt-3">
          <Link
            href="/login"
            className="inline-flex items-center justify-center gap-2 w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-xl text-sm transition shadow-md duration-200"
          >
            Return to Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-left">
      {errorMsg && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Email or Username Identifier */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
          Email Address or Username
        </label>
        <div className="relative">
          <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            required
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="e.g. trader_name or you@example.com"
            className="w-full bg-slate-50 dark:bg-[#07090e] border border-slate-200 dark:border-[#1e2640] rounded-xl pl-10 pr-3.5 py-2.5 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition"
          />
        </div>
      </div>

      {/* Security Question Selection */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
          Security Question
        </label>
        <select
          value={securityQuestion}
          onChange={(e) => setSecurityQuestion(e.target.value)}
          className="w-full bg-slate-50 dark:bg-[#07090e] border border-slate-200 dark:border-[#1e2640] rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition"
        >
          {UNIVERSAL_SECURITY_QUESTIONS.map((q, idx) => (
            <option key={idx} value={q} className="bg-white dark:bg-[#0f1423]">
              {q}
            </option>
          ))}
        </select>
      </div>

      {/* Security Answer */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
          Security Answer
        </label>
        <div className="relative">
          <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            required
            value={securityAnswer}
            onChange={(e) => setSecurityAnswer(e.target.value)}
            placeholder="Enter your confidential security answer"
            className="w-full bg-slate-50 dark:bg-[#07090e] border border-slate-200 dark:border-[#1e2640] rounded-xl pl-10 pr-3.5 py-2.5 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition"
          />
        </div>
        <p className="text-[10px] text-slate-400 mt-1">
          Answer must match the security verification answer linked to your account.
        </p>
      </div>

      {/* Responsive hCaptcha widget */}
      <div className="pt-1">
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5 text-center sm:text-left">
          Security Verification
        </label>
        <div className="w-full max-w-[304px] mx-auto flex items-center justify-center">
          <ResponsiveHCaptcha
            ref={captchaRef}
            onVerify={(token) => {
              setCaptchaToken(token);
              setErrorMsg('');
            }}
            onExpire={() => setCaptchaToken('')}
            onError={() => {
              setCaptchaToken('');
              setErrorMsg('Failed to load security challenge. Please try again.');
            }}
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-md transition-colors duration-200 mt-2 disabled:opacity-50 cursor-pointer text-sm flex items-center justify-center gap-2"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Verifying Security Details...</span>
          </span>
        ) : (
          'Send Password Reset Link'
        )}
      </button>

      <div className="text-center pt-2">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white transition"
        >
          <ArrowLeft className="h-3 w-3" />
          <span>Back to Sign In</span>
        </Link>
      </div>
    </form>
  );
}
