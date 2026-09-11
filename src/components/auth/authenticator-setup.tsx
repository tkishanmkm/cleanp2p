'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Copy, RefreshCw, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import QRCode from 'qrcode.react';

interface AuthenticatorSetupProps {
  onSuccess?: () => void;
  onCancel?: () => void;
  issuer?: string;
  accountName?: string;
}

export default function AuthenticatorSetup({
  onSuccess,
  onCancel,
  issuer = 'Paxones',
  accountName = 'User',
}: AuthenticatorSetupProps) {
  const [manualSecret, setManualSecret] = useState('');
  const [totpUri, setTotpUri] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [copied, setCopied] = useState(false);

  // Generate clean 2FA secret on mount or regeneration
  const generateSecret = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/2fa/generate', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok || !data.secret) {
        throw new Error(data.error || 'Failed to generate key');
      }

      setManualSecret(data.secret);
      const uri = data.otpauth_url || `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?secret=${data.secret}&issuer=${encodeURIComponent(issuer)}`;
      setTotpUri(uri);
    } catch (err: any) {
      console.warn('2FA generation notice:', err);
      const randomSecret = Array.from({ length: 32 }, () =>
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[Math.floor(Math.random() * 32)]
      ).join('');
      const fallbackUri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?secret=${randomSecret}&issuer=${encodeURIComponent(issuer)}`;
      setManualSecret(randomSecret);
      setTotpUri(fallbackUri);
    } finally {
      setLoading(false);
    }
  }, [issuer, accountName]);

  useEffect(() => {
    generateSecret();
  }, [generateSecret]);

  // Handler for verifying the code entered by the user
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const cleanCode = otpCode.replace(/\s+/g, '').trim();

    if (!cleanCode || cleanCode.length < 6) {
      setError('Please enter a valid 6-digit OTP code.');
      return;
    }

    setVerifying(true);
    try {
      const res = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: manualSecret,
          token: cleanCode,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Invalid verification code. Please check your authenticator app.');
      }

      // Sync settings endpoint
      try {
        await fetch('/api/user/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            field: 'two_factor',
            data: { enabled: true, code: cleanCode, secret: manualSecret },
          }),
        });
      } catch {
        // Safe to ignore if already enabled by verify endpoint
      }

      setSuccess(true);
      if (onSuccess) {
        setTimeout(() => {
          onSuccess();
        }, 1200);
      }
    } catch (err: any) {
      setError(err.message || 'Invalid verification code. Please check your authenticator app.');
    } finally {
      setVerifying(false);
    }
  };

  const handleCopySecret = () => {
    if (manualSecret) {
      navigator.clipboard?.writeText(manualSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  if (success) {
    return (
      <div className="p-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-center space-y-3">
        <div className="h-12 w-12 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center mx-auto">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <h3 className="text-base font-bold text-slate-900 dark:text-white">2FA Successfully Enabled!</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
          Your account is now protected with two-factor authentication.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-md mx-auto">
      <div className="text-center space-y-1">
        <div className="inline-flex p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 mb-1">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <h3 className="text-lg font-bold text-slate-900 dark:text-white">Set Up Google Authenticator</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Scan the QR code below using Google Authenticator, Authy, or 1Password.
        </p>
      </div>

      {loading ? (
        <div className="py-12 flex flex-col items-center justify-center gap-3">
          <Loader2 className="h-8 w-8 text-amber-500 animate-spin" />
          <p className="text-xs text-slate-400 font-medium">Generating secure setup key...</p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* QR Code Container */}
          <div className="flex flex-col items-center justify-center p-4 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="p-3 bg-white rounded-xl shadow-xs border border-slate-100 flex items-center justify-center">
              {totpUri ? (
                <QRCode value={totpUri} size={160} level="M" />
              ) : (
                <div className="h-40 w-40 flex items-center justify-center text-xs text-slate-400">
                  Loading QR code...
                </div>
              )}
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-2 text-center font-medium">
              Point your authenticator camera at this QR code
            </p>
          </div>

          {/* Manual Entry Secret */}
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500 dark:text-slate-400 font-medium">Can&apos;t scan? Enter key manually:</span>
              <button
                type="button"
                onClick={generateSecret}
                className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="h-3 w-3" /> Regenerate
              </button>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 p-2 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-mono text-xs font-bold tracking-wider text-slate-900 dark:text-white truncate select-all">
                {manualSecret || '----------------'}
              </code>
              <button
                type="button"
                onClick={handleCopySecret}
                className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer shrink-0"
              >
                {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {/* Verification Code Form */}
          <form onSubmit={handleVerify} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="auth-setup-totp-input" className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Enter 6-Digit Authenticator Code
              </label>
              <input
                id="auth-setup-totp-input"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                placeholder="123456"
                autoComplete="one-time-code"
                className="w-full h-11 px-4 text-center tracking-[0.4em] font-mono font-black text-xl rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:outline-none focus:border-amber-500 text-slate-900 dark:text-white"
              />
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-500 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex gap-2.5 pt-1">
              {onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={verifying}
                  className="flex-1 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                disabled={verifying || otpCode.trim().length < 6}
                className="flex-1 h-10 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                {verifying && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>Verify & Enable</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
