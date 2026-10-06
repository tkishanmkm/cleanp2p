"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertCircle, ShieldCheck, KeyRound, ArrowLeft, Loader2, CheckCircle2 } from "lucide-react";
import { Logo } from "@/components/logo";
import Link from "next/link";

function Admin2FAChallengeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") || "/adminnarayan/dashboard";

  const [code, setCode] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [newRecoveryKey, setNewRecoveryKey] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    try {
      const payload = useRecovery
        ? { recoveryPassword: recoveryPassword.trim() }
        : { code: code.replace(/\s+/g, "").trim() };

      const res = await fetch("/api/admin/auth/2fa-challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.error || "2FA verification failed. Please check your credentials.");
      }

      if (data.newRecoveryPassword) {
        setNewRecoveryKey(data.newRecoveryPassword);
        setLoading(false);
        return;
      }

      // 2FA Verified! Navigate to destination
      router.push(redirectTo);
      router.refresh();

      setTimeout(() => {
        if (window.location.pathname.includes("/challenge")) {
          window.location.assign(redirectTo);
        }
      }, 500);
    } catch (err: any) {
      setErrorMsg(err.message || "An unexpected error occurred during verification.");
      setLoading(false);
    }
  };

  const handleAcknowledgeNewKeyAndProceed = () => {
    router.push(redirectTo);
    router.refresh();
    setTimeout(() => {
      window.location.assign(redirectTo);
    }, 400);
  };

  if (newRecoveryKey) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-900 text-slate-100">
        <Card className="w-full max-w-md bg-slate-800 border-amber-500/40 shadow-2xl">
          <CardHeader className="space-y-3">
            <div className="flex items-center justify-between">
              <Logo variant="desktop" priority />
              <div className="w-9 h-9 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5 text-amber-400" />
              </div>
            </div>
            <div>
              <CardTitle className="text-xl font-bold text-white">Emergency Recovery Used</CardTitle>
              <CardDescription className="text-slate-300">
                Your emergency recovery password was verified. A fresh one-time recovery key has been generated.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-3.5 bg-slate-950/80 border border-amber-500/50 rounded-lg space-y-2">
              <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">New Recovery Key</span>
              <p className="font-mono text-sm sm:text-base font-bold text-white tracking-widest break-all select-all">
                {newRecoveryKey}
              </p>
            </div>
            <p className="text-xs text-slate-400">
              Please save this key in a secure offline vault. It replaces your old recovery password.
            </p>
            <Button
              id="ack-recovery-key-btn"
              onClick={handleAcknowledgeNewKeyAndProceed}
              className="w-full bg-amber-600 hover:bg-amber-500 text-white font-medium"
            >
              I Have Saved My New Key — Continue to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-900 text-slate-100">
      <Card className="w-full max-w-md bg-slate-800 border-slate-700 shadow-2xl">
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between">
            <Link href="/" title="Back to Marketplace">
              <Logo variant="desktop" priority />
            </Link>
            <div className="w-9 h-9 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-blue-400" />
            </div>
          </div>
          <div>
            <CardTitle className="text-2xl font-bold text-white">Two-Factor Authentication</CardTitle>
            <CardDescription className="text-slate-400">
              {useRecovery
                ? "Enter your 2FA emergency recovery password to access the portal."
                : "Enter the 6-digit code from your authenticator app (Google Authenticator, Authy, etc.)."}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorMsg && (
            <div className="p-3 bg-red-950/80 border border-red-500/50 text-red-200 rounded-lg text-sm flex items-start gap-2 break-words">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-red-300">Verification Failed</p>
                <p>{errorMsg}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {!useRecovery ? (
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">6-Digit Authenticator Code</label>
                <Input
                  id="admin-2fa-code-input"
                  name="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={8}
                  placeholder="123456"
                  autoFocus
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="bg-slate-900 border-slate-700 text-white font-mono text-center tracking-widest text-lg h-12"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Emergency Recovery Password</label>
                <Input
                  id="admin-2fa-recovery-input"
                  name="recoveryPassword"
                  type="password"
                  placeholder="pax-rec-XXXX-XXXX-XXXX"
                  autoFocus
                  required
                  value={recoveryPassword}
                  onChange={(e) => setRecoveryPassword(e.target.value)}
                  className="bg-slate-900 border-slate-700 text-white font-mono text-sm h-12"
                />
              </div>
            )}

            <Button
              id="admin-2fa-submit-btn"
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium h-11"
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Verifying Security Token...
                </span>
              ) : (
                "Verify & Enter Portal"
              )}
            </Button>
          </form>

          <div className="pt-2 border-t border-slate-700/60 flex flex-col gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setUseRecovery(!useRecovery);
                setErrorMsg(null);
                setCode("");
                setRecoveryPassword("");
              }}
              className="w-full text-xs text-blue-400 hover:text-blue-300 hover:bg-slate-700/50"
            >
              {useRecovery ? (
                <span className="flex items-center gap-1.5">
                  <ArrowLeft className="w-3.5 h-3.5" /> Use Authenticator 6-Digit Code
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5" /> Lost access? Use Recovery Password
                </span>
              )}
            </Button>

            <Link
              href="/adminnarayan/login"
              className="text-center text-xs text-slate-400 hover:text-slate-200 transition-colors py-1"
            >
              Return to Login
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Admin2FAChallengePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center p-4 bg-slate-900 text-slate-100">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      }
    >
      <Admin2FAChallengeForm />
    </Suspense>
  );
}
