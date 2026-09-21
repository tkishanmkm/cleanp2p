'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Lock,
  CheckCircle2,
  ShieldAlert,
  Loader2,
  ArrowRight,
  Eye,
  EyeOff,
  HelpCircle,
  KeyRound,
  ShieldCheck,
  RotateCcw,
} from 'lucide-react';
import { Logo } from '@/components/logo';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import { UNIVERSAL_SECURITY_QUESTIONS } from '@/lib/settings-constants';

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [securityQuestion, setSecurityQuestion] = useState(UNIVERSAL_SECURITY_QUESTIONS[0]);
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [hasExistingQuestion, setHasExistingQuestion] = useState(false);

  const [loading, setLoading] = useState(false);
  const [isVerifyingSession, setIsVerifyingSession] = useState(true);
  const [isSessionActive, setIsSessionActive] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [success, setSuccess] = useState(false);
  const [userEmail, setUserEmail] = useState<string>('');

  useEffect(() => {
    let isMounted = true;

    // Check query params for immediate error from callback
    const queryError = searchParams.get('error') || searchParams.get('error_description');
    if (queryError) {
      setErrorMsg(decodeURIComponent(queryError));
    }

    const initAuthSession = async () => {
      try {
        // 1. Check for PKCE 'code' in query params
        const code = searchParams.get('code');
        if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (!error && data?.session) {
            if (isMounted) {
              setIsSessionActive(true);
              setUserEmail(data.session.user.email || '');
              await loadUserProfile(data.session.user.id);
              setIsVerifyingSession(false);
              return;
            }
          }
        }

        // 2. Check for OTP 'token_hash' in query params
        const tokenHash = searchParams.get('token_hash');
        const tokenType = (searchParams.get('type') || 'recovery') as any;
        if (tokenHash) {
          const { data, error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: tokenType,
          });
          if (!error && data?.session) {
            if (isMounted) {
              setIsSessionActive(true);
              setUserEmail(data.session.user.email || '');
              await loadUserProfile(data.session.user.id);
              setIsVerifyingSession(false);
              return;
            }
          }
        }

        // 3. Check for URL Hash fragment (#access_token=...&refresh_token=...)
        if (typeof window !== 'undefined' && window.location.hash) {
          const hashStr = window.location.hash.startsWith('#')
            ? window.location.hash.substring(1)
            : window.location.hash;
          const hashParams = new URLSearchParams(hashStr);
          const accessToken = hashParams.get('access_token');
          const refreshToken = hashParams.get('refresh_token');

          if (accessToken && refreshToken) {
            const { data, error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (!error && data?.session) {
              if (isMounted) {
                setIsSessionActive(true);
                setUserEmail(data.session.user.email || '');
                await loadUserProfile(data.session.user.id);
                setIsVerifyingSession(false);
                return;
              }
            }
          }
        }

        // 4. Check existing session in cookies / storage
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          if (isMounted) {
            setIsSessionActive(true);
            setUserEmail(session.user.email || '');
            await loadUserProfile(session.user.id);
            setIsVerifyingSession(false);
            return;
          }
        }

        // 5. Short fallback grace period for background token initialization
        setTimeout(async () => {
          if (!isMounted) return;
          const { data: { session: delayedSession } } = await supabase.auth.getSession();
          if (delayedSession) {
            setIsSessionActive(true);
            setUserEmail(delayedSession.user.email || '');
            await loadUserProfile(delayedSession.user.id);
          } else {
            setIsSessionActive(false);
          }
          setIsVerifyingSession(false);
        }, 1000);
      } catch (err: any) {
        console.error('[Reset Password] Session check error:', err);
        if (isMounted) {
          setIsSessionActive(false);
          setIsVerifyingSession(false);
        }
      }
    };

    const loadUserProfile = async (userId: string) => {
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('security_question')
          .eq('id', userId)
          .maybeSingle();

        if (profile?.security_question) {
          setSecurityQuestion(profile.security_question);
          setHasExistingQuestion(true);
        } else {
          setHasExistingQuestion(false);
        }
      } catch (e) {
        console.warn('Profile question load warning:', e);
      }
    };

    // Listen to Supabase Auth State changes (including PASSWORD_RECOVERY event)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        setIsSessionActive(true);
        setUserEmail(session.user.email || '');
        await loadUserProfile(session.user.id);
        setIsVerifyingSession(false);
      }
    });

    initAuthSession();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [searchParams, supabase]);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!securityAnswer.trim()) {
      setErrorMsg('Please enter your security question answer.');
      return;
    }

    if (!newPassword || newPassword.length < 8) {
      setErrorMsg('New password must be at least 8 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match. Please re-enter both passwords carefully.');
      return;
    }

    setLoading(true);

    try {
      // Get current active session token to forward in header
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      // Call our secure server endpoint that verifies security questions & updates password
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          password: newPassword,
          securityQuestion,
          securityAnswer: securityAnswer.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to update password. Please check your security answer.');
      }

      // Also ensure client session state is refreshed
      try {
        await supabase.auth.updateUser({ password: newPassword });
      } catch (clientUpdateErr) {
        // Non-blocking since server admin client already updated credentials
      }

      setSuccess(true);
      setTimeout(() => {
        router.push('/login');
      }, 2500);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update password. Please request a new recovery link if expired.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-[#07090e] p-4">
      <Card className="w-full max-w-md bg-white dark:bg-[#0d111d] border-slate-200 dark:border-slate-800 shadow-xl rounded-2xl">
        <CardHeader className="text-center pb-4">
          <Link href="/" className="flex justify-center mb-3">
            <Logo />
          </Link>
          <div className="w-12 h-12 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-2xl flex items-center justify-center mx-auto border border-blue-500/20 mb-2">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <CardTitle className="text-xl font-bold text-slate-900 dark:text-white">
            Set New Password
          </CardTitle>
          <CardDescription className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {userEmail ? (
              <span>
                Resetting password for <span className="font-semibold text-slate-700 dark:text-slate-300">{userEmail}</span>
              </span>
            ) : (
              'Verify your security question and set your new account password.'
            )}
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-0">
          {success ? (
            <div className="text-center space-y-4 py-4">
              <div className="w-14 h-14 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto border border-emerald-500/20">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Password Reset Successful</h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Your password has been updated. You will be redirected to the login page momentarily.
              </p>
              <div className="pt-2">
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center gap-2 w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-4 rounded-xl text-xs transition shadow-md"
                >
                  Proceed to Login <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          ) : isVerifyingSession ? (
            <div className="py-12 text-center space-y-3">
              <Loader2 className="w-7 h-7 animate-spin text-blue-600 mx-auto" />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Verifying recovery credentials...
              </p>
            </div>
          ) : isSessionActive === false ? (
            <div className="text-center space-y-4 py-4">
              <div className="w-12 h-12 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-full flex items-center justify-center mx-auto border border-amber-500/20">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Session Link Missing or Expired
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                We couldn&apos;t detect an active recovery session. Password recovery links are valid for a single use and expire after 1 hour.
              </p>
              <div className="pt-2 flex flex-col gap-2">
                <Link
                  href="/forgot-password"
                  className="inline-flex items-center justify-center gap-2 w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-4 rounded-xl text-xs transition shadow-md"
                >
                  <RotateCcw className="w-4 h-4" /> Request New Recovery Link
                </Link>
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center gap-2 w-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium py-2.5 px-4 rounded-xl text-xs transition"
                >
                  Back to Sign In
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleUpdatePassword} className="space-y-4 text-left">
              {errorMsg && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Security Question */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <HelpCircle className="w-3.5 h-3.5 text-blue-500" />
                  <span>Security Question</span>
                </label>
                {hasExistingQuestion ? (
                  <div className="w-full bg-slate-50 dark:bg-[#07090e] border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-white font-medium">
                    {securityQuestion}
                  </div>
                ) : (
                  <select
                    value={securityQuestion}
                    onChange={(e) => setSecurityQuestion(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-[#07090e] border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition"
                  >
                    {UNIVERSAL_SECURITY_QUESTIONS.map((q, idx) => (
                      <option key={idx} value={q} className="bg-white dark:bg-[#0f1423]">
                        {q}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Security Answer */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-blue-500" />
                  <span>Security Answer</span>
                </label>
                <input
                  type="text"
                  required
                  value={securityAnswer}
                  onChange={(e) => setSecurityAnswer(e.target.value)}
                  placeholder="Enter your confidential security answer"
                  className="w-full bg-slate-50 dark:bg-[#07090e] border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition"
                />
              </div>

              {/* New Password */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-blue-500" />
                  <span>New Password</span>
                </label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="w-full bg-slate-50 dark:bg-[#07090e] border border-slate-200 dark:border-slate-800 rounded-xl pl-3.5 pr-10 py-2.5 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus:outline-none"
                    aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-blue-500" />
                  <span>Confirm New Password</span>
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Retype password"
                    className="w-full bg-slate-50 dark:bg-[#07090e] border border-slate-200 dark:border-slate-800 rounded-xl pl-3.5 pr-10 py-2.5 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus:outline-none"
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-xl text-xs transition shadow-md disabled:opacity-50 cursor-pointer"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Verifying & Setting Password...</span>
                  </>
                ) : (
                  'Set New Password'
                )}
              </button>

              <div className="text-center pt-2">
                <Link
                  href="/login"
                  className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 transition"
                >
                  Remember password? Back to Login
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-[#07090e] p-4">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
