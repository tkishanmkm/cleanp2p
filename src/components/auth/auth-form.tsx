'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { Logo } from '@/components/logo';
import { Mail, Lock, User, Calendar, ArrowRight, AlertTriangle, ShieldCheck, Loader2, Shield } from 'lucide-react';
import { generateUniqueUsername } from '@/lib/auth';
import { getURL } from '@/utils/get-url';
import { ResponsiveHCaptcha, ResponsiveHCaptchaRef } from '@/components/auth/responsive-hcaptcha';

interface AuthFormProps {
  mode: 'login' | 'signup';
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingOAuth, setLoadingOAuth] = useState<'google' | 'discord' | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSuspendedAlert, setIsSuspendedAlert] = useState(false);
  const [suspensionDetails, setSuspensionDetails] = useState('');
  const [signupSuccess, setSignupSuccess] = useState(false);
  const [showMinorModal, setShowMinorModal] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const captchaRef = useRef<ResponsiveHCaptchaRef>(null);

  // 2FA Challenge States during login
  const [show2FAStep, setShow2FAStep] = useState(false);
  const [twoFaCode, setTwoFaCode] = useState('');
  const [verifying2FA, setVerifying2FA] = useState(false);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  // Social OAuth Handler (Google & Discord)
  const handleOAuthSignIn = async (provider: 'google' | 'discord') => {
    setErrorMsg('');
    setIsSuspendedAlert(false);
    setLoadingOAuth(provider);

    try {
      const url = getURL();

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${url}/auth/callback`,
        },
      });

      if (error) {
        throw error;
      }

      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (err: any) {
      console.error(`${provider} OAuth error:`, err);
      setErrorMsg(err.message || `Failed to initiate ${provider} login. Please try again.`);
      setLoadingOAuth(null);
    }
  };

  // Pure Supabase Email & Password Authentication
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    e.stopPropagation();
    setErrorMsg('');
    setIsSuspendedAlert(false);
    setSuspensionDetails('');

    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setErrorMsg('Please enter your email address');
      return;
    }

    if (!password) {
      setErrorMsg('Please enter your password');
      return;
    }

    if (!captchaToken) {
      setErrorMsg('Please complete the hCaptcha security verification box.');
      return;
    }

    if (mode === 'signup') {
      if (!name.trim()) {
        setErrorMsg('Please enter your legal full name');
        return;
      }
      if (!dob) {
        setErrorMsg('Please enter your date of birth');
        return;
      }

      // 18+ Child Safety check
      const birthDate = new Date(dob);
      if (!isNaN(birthDate.getTime())) {
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
          age--;
        }
        if (age < 18) {
          setShowMinorModal(true);
          return;
        }
      }

      if (password.length < 6) {
        setErrorMsg('Password must be at least 6 characters long');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMsg('Passwords do not match');
        return;
      }
      if (!acceptTerms) {
        setErrorMsg('You must agree to the Terms of Service and Privacy Notice to proceed');
        return;
      }
    }

    setLoading(true);

    try {
      if (mode === 'signup') {
        // Step 1: Pre-Registration Duplicate Identity Check (Name + DOB)
        const validateRes = await fetch('/api/auth/validate-registration', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            dob: dob.trim(),
            email: cleanEmail,
          }),
        });

        const validateData = await validateRes.json();

        if (!validateRes.ok || validateData.error) {
          if (validateData.suspended || validateData.code === 'DUPLICATE_IDENTITY_SUSPENDED') {
            setIsSuspendedAlert(true);
            setSuspensionDetails(validateData.error);
          } else {
            setErrorMsg(validateData.error || 'Identity verification check failed.');
          }
          setLoading(false);
          setCaptchaToken('');
          captchaRef.current?.resetCaptcha();
          return;
        }

        // Step 2: Sign Up via Pure Supabase GoTrue Engine with auto-generated username
        const autoGeneratedUsername = generateUniqueUsername();

        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            captchaToken: captchaToken,
            data: {
              full_name: name.trim(),
              name: name.trim(),
              username: autoGeneratedUsername,
              display_name: autoGeneratedUsername,
              dob: dob.trim(),
              date_of_birth: dob.trim(),
            },
            emailRedirectTo: `${getURL()}/auth/callback`,
          },
        });

        if (error) {
          console.error('Sign-up error:', error.message);
          setErrorMsg(error.message);
          setCaptchaToken('');
          captchaRef.current?.resetCaptcha();
          return;
        }

        // Auto-link profile data if session is immediately active
        if (data.user) {
          await supabase
            .from('profiles')
            .update({
              full_name: name.trim(),
              name: name.trim(),
              username: autoGeneratedUsername,
              display_name: autoGeneratedUsername,
              dob: dob.trim(),
              date_of_birth: dob.trim(),
            })
            .eq('id', data.user.id);
        }

        if (data.session) {
          window.location.href = '/buy';
          return;
        }

        setSignupSuccess(true);
      } else {
        // Step 3: Pure Email & Password Login with captchaToken
        const { data, error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password: password,
          options: {
            captchaToken: captchaToken,
          },
        });

        if (error) {
          console.error('Login error:', error.message);
          setErrorMsg(error.message);
          setCaptchaToken('');
          captchaRef.current?.resetCaptcha();
          return;
        }

        // Check if account has been suspended or requires 2FA
        if (data.user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('status, is_suspended, suspension_reason, is_2fa_enabled, is_mfa_enabled')
            .eq('id', data.user.id)
            .maybeSingle();

          if (profile?.is_suspended || profile?.status === 'suspended') {
            await supabase.auth.signOut();
            setIsSuspendedAlert(true);
            setSuspensionDetails(
              profile.suspension_reason ||
                'This account has been suspended due to duplicate identity or terms violation.'
            );
            return;
          }

          if (profile?.is_2fa_enabled || profile?.is_mfa_enabled) {
            setShow2FAStep(true);
            setPendingUserId(data.user.id);
            setLoading(false);
            return;
          }
        }

        if (data.session || data.user) {
          window.location.href = '/buy';
          return;
        }
      }
    } catch (err: any) {
      console.error('Auth exception:', err);
      setErrorMsg(err.message || 'Authentication request failed. Please check your credentials.');
      setCaptchaToken('');
      captchaRef.current?.resetCaptcha();
    } finally {
      setLoading(false);
    }
  }

  const handleVerifyLogin2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = twoFaCode.replace(/[\s-]+/g, '').trim();
    if (!cleanCode || cleanCode.length < 4 || cleanCode.length > 8) {
      setErrorMsg('Please enter a valid 4-8 digit OTP code from your authenticator app.');
      return;
    }

    setVerifying2FA(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: pendingUserId,
          code: cleanCode,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Invalid 2FA verification code');
      }

      window.location.href = '/buy';
    } catch (err: any) {
      setErrorMsg(err.message || '2FA verification failed. Please try again.');
    } finally {
      setVerifying2FA(false);
    }
  };

  // Sign-up confirmation prompt
  if (signupSuccess) {
    return (
      <div className="w-full max-w-md mx-auto p-6 bg-white dark:bg-[#0b0e17] rounded-2xl border border-slate-200 dark:border-[#1e2640] shadow-xl text-center space-y-4 animate-in fade-in zoom-in-95 duration-200">
        <div className="mx-auto w-14 h-14 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 flex items-center justify-center">
          <Mail className="w-7 h-7" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Verify Your Email</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          We&apos;ve dispatched a confirmation link to <span className="font-semibold text-blue-600 dark:text-blue-400">{email}</span>. Click the link inside to activate your Paxones account and begin peer-to-peer trading.
        </p>
        <div className="pt-2">
          <Link
            href="/login"
            className="inline-flex items-center justify-center gap-2 w-full min-h-[46px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition-all"
          >
            Return to Sign In
          </Link>
        </div>
      </div>
    );
  }

  // 2FA Challenge Prompt during Email/Password Login
  if (show2FAStep) {
    return (
      <div className="w-full max-w-md mx-auto p-6 bg-white dark:bg-[#0b0e17] rounded-2xl border border-slate-200 dark:border-[#1e2640] shadow-xl space-y-5 animate-in fade-in duration-200">
        <div className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 flex items-center justify-center">
            <Shield className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Two-Factor Authentication</h2>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Enter the 6-digit security code generated by your Google Authenticator or 2FA app.
          </p>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleVerifyLogin2FA} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              6-Digit Authenticator Code
            </label>
            <input
              type="text"
              required
              maxLength={8}
              autoFocus
              value={twoFaCode}
              onChange={(e) => setTwoFaCode(e.target.value)}
              placeholder="000 000"
              className="w-full bg-slate-50 dark:bg-[#07090e] border border-slate-200 dark:border-[#1e2640] rounded-xl px-4 py-3 text-center text-lg font-mono tracking-widest text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition"
            />
          </div>

          <button
            type="submit"
            disabled={verifying2FA}
            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-md transition-colors duration-200 disabled:opacity-50 cursor-pointer text-sm flex items-center justify-center gap-2"
          >
            {verifying2FA ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Verifying Security Code...</span>
              </span>
            ) : (
              'Verify & Continue to Account'
            )}
          </button>
        </form>

        <div className="text-center pt-2">
          <button
            type="button"
            onClick={() => {
              setShow2FAStep(false);
              setTwoFaCode('');
              setErrorMsg('');
            }}
            className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white transition cursor-pointer"
          >
            Back to Email Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto p-6 sm:p-8 bg-white dark:bg-[#0b0e17] rounded-2xl border border-slate-200 dark:border-[#1e2640] shadow-xl">
      {/* Brand Header */}
      <div className="flex flex-col items-center mb-6">
        <Logo />
        <h1 className="text-xl font-bold text-slate-900 dark:text-white mt-3">
          {mode === 'login' ? 'Welcome Back' : 'Create Free Account'}
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 text-center mt-1">
          {mode === 'login'
            ? 'Access your secure P2P cryptocurrency wallet and trades'
            : 'Join thousands of traders globally on Paxones P2P'}
        </p>
      </div>

      {/* Social Logins: Google & Discord (100% Captcha-Free) */}
      <div className="space-y-2.5 mb-5">
        <button
          type="button"
          onClick={() => handleOAuthSignIn('google')}
          disabled={loading || loadingOAuth !== null}
          className="w-full min-h-[46px] px-4 rounded-xl border border-slate-200 dark:border-[#1e2640] bg-white dark:bg-[#07090e] hover:bg-slate-50 dark:hover:bg-[#121829] active:scale-[0.99] text-slate-700 dark:text-slate-200 font-semibold text-xs sm:text-sm transition-all flex items-center justify-center gap-3 shadow-xs cursor-pointer disabled:opacity-50"
        >
          {loadingOAuth === 'google' ? (
            <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
          ) : (
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
          )}
          <span>Continue with Google</span>
        </button>

        <button
          type="button"
          onClick={() => handleOAuthSignIn('discord')}
          disabled={loading || loadingOAuth !== null}
          className="w-full min-h-[46px] px-4 rounded-xl border border-slate-200 dark:border-[#1e2640] bg-white dark:bg-[#07090e] hover:bg-slate-50 dark:hover:bg-[#121829] active:scale-[0.99] text-slate-700 dark:text-slate-200 font-semibold text-xs sm:text-sm transition-all flex items-center justify-center gap-3 shadow-xs cursor-pointer disabled:opacity-50"
        >
          {loadingOAuth === 'discord' ? (
            <Loader2 className="w-4 h-4 animate-spin text-[#5865F2]" />
          ) : (
            <svg className="w-4 h-4 shrink-0 text-[#5865F2]" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
            </svg>
          )}
          <span>Continue with Discord</span>
        </button>
      </div>

      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-200 dark:border-[#1e2640]"></div>
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="px-3 bg-white dark:bg-[#0b0e17] text-slate-400 font-medium">
            or continue with email
          </span>
        </div>
      </div>

      {/* Account Suspended Alert */}
      {isSuspendedAlert && (
        <div className="mb-4 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs space-y-1">
          <div className="flex items-center gap-2 font-bold text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Account Suspension Notice</span>
          </div>
          <p className="leading-relaxed">
            {suspensionDetails || 'This account has been suspended due to duplicate identity or terms violation.'}
          </p>
          <div className="pt-2 flex items-center gap-2">
            <Link
              href="/support"
              className="text-xs font-semibold underline hover:text-rose-700 dark:hover:text-rose-300"
            >
              Contact Support for Appeal
            </Link>
          </div>
        </div>
      )}

      {/* General Error Alert */}
      {errorMsg && (
        <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Email & Password Form */}
      <form onSubmit={handleSubmit} className="space-y-3.5">
        {mode === 'signup' && (
          <>
            <div>
              <label
                htmlFor="auth-fullname"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Full Legal Name
              </label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="auth-fullname"
                  name="fullname"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Legal Name as per ID"
                  className="w-full bg-slate-50 dark:bg-[#07090e] border border-slate-200 dark:border-[#1e2640] rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="auth-dob"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Date of Birth (Must be 18+)
              </label>
              <div className="relative">
                <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="auth-dob"
                  name="dob"
                  type="date"
                  required
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-[#07090e] border border-slate-200 dark:border-[#1e2640] rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                />
              </div>
            </div>
          </>
        )}

        <div>
          <label
            htmlFor="auth-email"
            className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
          >
            Email Address
          </label>
          <div className="relative">
            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              id="auth-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-slate-50 dark:bg-[#07090e] border border-slate-200 dark:border-[#1e2640] rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
            />
          </div>
        </div>

        <div>
          <div className="flex justify-between items-center mb-1">
            <label
              htmlFor="auth-password"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Password
            </label>
            {mode === 'login' && (
              <Link
                href="/forgot-password"
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                Forgot password?
              </Link>
            )}
          </div>
          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              id="auth-password"
              name="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-slate-50 dark:bg-[#07090e] border border-slate-200 dark:border-[#1e2640] rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
            />
          </div>
        </div>

        {mode === 'signup' && (
          <div>
            <label
              htmlFor="auth-confirm-password"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Confirm Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                id="auth-confirm-password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-50 dark:bg-[#07090e] border border-slate-200 dark:border-[#1e2640] rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
              />
            </div>
          </div>
        )}

        {/* Responsive hCaptcha Verification Box (Matches form breadth & theme) */}
        <div className="pt-1">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            Security Verification
          </label>
          <div className="w-full bg-slate-50 dark:bg-[#07090e] border border-slate-200 dark:border-[#1e2640] rounded-xl p-2.5 flex items-center justify-center">
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

        {mode === 'signup' && (
          <div className="pt-1">
            <label className="flex items-start gap-2.5 cursor-pointer select-none text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={acceptTerms}
                onChange={(e) => setAcceptTerms(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                I agree to the{' '}
                <Link
                  href="/terms"
                  target="_blank"
                  className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                >
                  Terms of Service
                </Link>{' '}
                and{' '}
                <Link
                  href="/policy"
                  target="_blank"
                  className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                >
                  Privacy Notice
                </Link>
              </span>
            </label>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || loadingOAuth !== null}
          className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-md transition-colors duration-200 mt-2 disabled:opacity-50 cursor-pointer text-sm flex items-center justify-center gap-2"
        >
          {loading ? (
            <span>Verifying &amp; Processing...</span>
          ) : (
            <>
              <ShieldCheck className="w-4 h-4" />
              <span>{mode === 'login' ? 'Sign In with Email' : 'Create Account'}</span>
            </>
          )}
        </button>
      </form>

      {/* Footer Mode Switch */}
      <div className="text-center mt-6 text-xs text-slate-500 dark:text-slate-400">
        {mode === 'login' ? (
          <p>
            Don&apos;t have an account?{' '}
            <Link
              href="/signup"
              className="text-amber-600 dark:text-amber-400 hover:underline font-semibold"
            >
              Sign up
            </Link>
          </p>
        ) : (
          <p>
            Already have an account?{' '}
            <Link
              href="/login"
              className="text-amber-600 dark:text-amber-400 hover:underline font-semibold"
            >
              Sign in
            </Link>
          </p>
        )}
      </div>

      {/* Minor Safety Dialog (18+ Requirement) */}
      {showMinorModal && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-md bg-white dark:bg-[#0f1423] border border-rose-200 dark:border-rose-900/50 rounded-2xl shadow-2xl p-6 text-center space-y-4 animate-in fade-in zoom-in-95 duration-200 relative">
            <div className="mx-auto w-14 h-14 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                Age Requirement Notice (18+ Only)
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Paxones is a peer-to-peer cryptocurrency financial exchange and is strictly restricted to individuals 18 years of age or older for child safety and regulatory compliance.
              </p>
              <p className="text-xs text-rose-600 dark:text-rose-400 font-semibold pt-1">
                The date of birth you entered indicates you are under 18 years old.
              </p>
            </div>

            <div className="pt-3 flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => setShowMinorModal(false)}
                className="w-full sm:flex-1 min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-[0.98] text-slate-800 dark:text-slate-200 font-semibold text-sm transition-all touch-manipulation cursor-pointer flex items-center justify-center select-none shadow-xs"
              >
                Correct Date of Birth
              </button>
              <button
                type="button"
                disabled={isDeletingAccount}
                onClick={async () => {
                  setIsDeletingAccount(true);
                  try {
                    await fetch('/api/user/delete-account', { method: 'POST' }).catch(() => {});
                    await supabase.auth.signOut().catch(() => {});
                  } finally {
                    setIsDeletingAccount(false);
                    setShowMinorModal(false);
                    setName('');
                    setDob('');
                    setEmail('');
                    setPassword('');
                    setConfirmPassword('');
                  }
                }}
                className="w-full sm:flex-1 min-h-[48px] px-4 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white font-semibold text-sm transition-all touch-manipulation cursor-pointer flex items-center justify-center select-none disabled:opacity-50 shadow-md shadow-rose-600/20"
              >
                {isDeletingAccount ? 'Deleting...' : 'Delete Account / Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
