'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { Logo } from '@/components/logo';
import { CheckCircle2, Mail, Lock, User, CheckSquare, Square, ArrowRight } from 'lucide-react';

interface AuthFormProps {
  mode: 'login' | 'signup';
}

export function AuthForm({ mode }: AuthFormProps) {
  const supabase = createClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [signupSuccess, setSignupSuccess] = useState(false);

  // Google OAuth Login / Signup
  async function handleGoogleAuth() {
    try {
      setLoading(true);
      setErrorMsg('');
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/api/auth/callback`,
        },
      });
      if (error) throw error;
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to initialize Google authentication');
      setLoading(false);
    }
  }

  // Discord OAuth Login / Signup
  async function handleDiscordAuth() {
    try {
      setLoading(true);
      setErrorMsg('');
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'discord',
        options: {
          redirectTo: `${window.location.origin}/api/auth/callback`,
        },
      });
      if (error) throw error;
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to initialize Discord authentication');
      setLoading(false);
    }
  }

  // Password-Based Login / Signup
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');

    if (mode === 'signup') {
      if (!name.trim()) {
        setErrorMsg('Please enter your full name');
        return;
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
        setErrorMsg('You must agree to the Terms of Service and Privacy Policy to proceed');
        return;
      }
    }

    setLoading(true);

    try {
      if (mode === 'signup') {
        const cleanUsername = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').substring(0, 20) || 'trader';
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              full_name: name.trim(),
              username: cleanUsername,
              name: name.trim(),
            },
            emailRedirectTo: `${window.location.origin}/api/auth/callback`,
          },
        });

        if (error) throw error;

        // If session was directly established without email verification requirement
        if (data.session) {
          window.location.href = '/buy';
          return;
        }

        // Show verification prompt
        setSignupSuccess(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        window.location.href = '/buy';
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  if (signupSuccess) {
    return (
      <div className="w-full max-w-md mx-auto p-6 sm:p-8 bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] rounded-2xl text-slate-900 dark:text-slate-100 shadow-xl dark:shadow-2xl text-center">
        <div className="w-16 h-16 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-500/20">
          <Mail className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Check your inbox</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-6 leading-relaxed">
          We have sent a verification link to <span className="font-semibold text-slate-900 dark:text-white">{email}</span>. Please confirm your email and log in to begin trading.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center justify-center gap-2 w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-xl text-sm transition shadow-sm"
        >
          <span>Go to Login</span>
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto p-6 sm:p-8 bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] rounded-2xl text-slate-900 dark:text-slate-100 shadow-xl dark:shadow-2xl transition-colors">
      {/* Brand Header & Logo */}
      <div className="flex flex-col items-center justify-center text-center mb-6">
        <Link href="/" className="inline-flex items-center justify-center mb-3 hover:opacity-90 transition-opacity">
          <Logo variant="desktop" />
        </Link>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
          {mode === 'login' ? 'Welcome Back' : 'Create an Account'}
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          {mode === 'login' ? 'Sign in to access your P2P trading dashboard' : 'Sign up to start trading securely'}
        </p>
      </div>

      {errorMsg && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl text-red-600 dark:text-red-400 text-xs">
          {errorMsg}
        </div>
      )}

      {/* 1. Official Google & Discord Single Sign-On Buttons */}
      <div className="space-y-2.5 mb-6">
        <button
          type="button"
          onClick={handleGoogleAuth}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-50 dark:bg-[#151a2d] dark:hover:bg-[#1b223a] text-slate-700 dark:text-slate-200 font-medium py-2.5 px-4 rounded-xl text-sm border border-slate-200 dark:border-slate-700/80 transition shadow-sm disabled:opacity-50 cursor-pointer"
        >
          <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.26v3.15C3.25 21.3 7.31 24 12 24z"
            />
            <path
              fill="#FBBC05"
              d="M5.28 14.24c-.25-.72-.38-1.49-.38-2.24s.13-1.52.38-2.24V6.61H1.26C.46 8.23 0 10.06 0 12s.46 3.77 1.26 5.39l4.02-3.15z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.25 2.7 1.26 6.61l4.02 3.15c.95-2.85 3.6-4.96 6.72-4.96z"
            />
          </svg>
          <span>Continue with Google</span>
        </button>

        <button
          type="button"
          onClick={handleDiscordAuth}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-50 dark:bg-[#151a2d] dark:hover:bg-[#1b223a] text-slate-700 dark:text-slate-200 font-medium py-2.5 px-4 rounded-xl text-sm border border-slate-200 dark:border-slate-700/80 transition shadow-sm disabled:opacity-50 cursor-pointer"
        >
          <svg className="w-5 h-5 shrink-0 fill-[#5865F2]" viewBox="0 0 127.14 96.36">
            <path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a74.57 74.57 0 0 0 64.3 0c.87.68 1.76 1.36 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.88-72.14zM42.45 65.69c-6.31 0-11.5-5.79-11.5-12.87 0-7.08 5.07-12.87 11.5-12.87 6.47 0 11.62 5.82 11.5 12.87 0 7.08-5.03 12.87-11.5 12.87zm42.24 0c-6.31 0-11.5-5.79-11.5-12.87 0-7.08 5.07-12.87 11.5-12.87 6.47 0 11.62 5.82 11.5 12.87 0 7.08-5.03 12.87-11.5 12.87z"/>
          </svg>
          <span>Continue with Discord</span>
        </button>
      </div>

      {/* Divider */}
      <div className="relative my-6 flex items-center justify-center">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-200 dark:border-[#1e2640]"></div>
        </div>
        <span className="relative bg-white dark:bg-[#0f1423] px-3 text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
          Or with Email
        </span>
      </div>

      {/* 2. Standard Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === 'signup' && (
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Full Name</label>
            <div className="relative">
              <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="John Doe"
                className="w-full bg-slate-50 dark:bg-[#07090e] border border-slate-200 dark:border-[#1e2640] rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
              />
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Email Address</label>
          <div className="relative">
            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="email"
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
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Password</label>
            {mode === 'login' && (
              <Link href="/forgot-password" className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                Forgot password?
              </Link>
            )}
          </div>
          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="password"
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
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Confirm Password</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-50 dark:bg-[#07090e] border border-slate-200 dark:border-[#1e2640] rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
              />
            </div>
          </div>
        )}

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
                <Link href="/terms" target="_blank" className="text-blue-600 dark:text-blue-400 hover:underline">
                  Terms of Service
                </Link>{' '}
                and{' '}
                <Link href="/policy" target="_blank" className="text-blue-600 dark:text-blue-400 hover:underline">
                  Privacy Policy
                </Link>
              </span>
            </label>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 font-semibold py-2.5 px-4 rounded-xl text-sm transition mt-2 disabled:opacity-50 cursor-pointer shadow-sm"
        >
          {loading ? 'Processing...' : mode === 'login' ? 'Sign In' : 'Create Account'}
        </button>
      </form>

      {/* Footer Mode Switch */}
      <div className="text-center mt-6 text-xs text-slate-500 dark:text-slate-400">
        {mode === 'login' ? (
          <p>
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="text-amber-600 dark:text-amber-400 hover:underline font-semibold">
              Sign up
            </Link>
          </p>
        ) : (
          <p>
            Already have an account?{' '}
            <Link href="/login" className="text-amber-600 dark:text-amber-400 hover:underline font-semibold">
              Sign in
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
