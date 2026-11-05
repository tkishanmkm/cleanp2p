'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { QRCodeSVG } from 'qrcode.react';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  QrCode,
  Sun,
  Moon,
  Laptop,
  Copy,
  CheckCircle2,
  RefreshCw,
  Loader2,
  Lock,
  Unlock,
  AlertTriangle,
  History,
  Info,
} from 'lucide-react';
import type { AdminSecurityState } from '@/lib/admin-security';

export function AdminSecurityClient() {
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [securityState, setSecurityState] = useState<AdminSecurityState | null>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);

  // Theme state
  const [activeTheme, setActiveTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [updatingTheme, setUpdatingTheme] = useState(false);

  // Setup / Enrollment Modal
  const [enrollModalOpen, setEnrollModalOpen] = useState(false);
  const [enrollLoading, setEnrollLoading] = useState(false);
  const [enrollSecret, setEnrollSecret] = useState('');
  const [enrollOtpauthUrl, setEnrollOtpauthUrl] = useState('');
  const [enrollCode, setEnrollCode] = useState('');
  const [verifyingEnable, setVerifyingEnable] = useState(false);
  const [issuedRecoveryPassword, setIssuedRecoveryPassword] = useState<string | null>(null);

  // Disable Modal
  const [disableModalOpen, setDisableModalOpen] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [disableRecoveryPassword, setDisableRecoveryPassword] = useState('');
  const [disabling2FA, setDisabling2FA] = useState(false);

  // Emergency Recover Modal
  const [recoverModalOpen, setRecoverModalOpen] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [recovering2FA, setRecovering2FA] = useState(false);

  // Copy state
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedRecovery, setCopiedRecovery] = useState(false);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/security/status');
      const data = await res.json();
      if (res.ok && data.success) {
        setSecurityState(data.state);
        setAuditLogs(data.logs || []);
        setActiveTheme(data.state.themePreference || 'system');
        applyThemeClass(data.state.themePreference || 'system');
      } else {
        toast({
          variant: 'destructive',
          title: 'Error Loading Security Status',
          description: data.error || 'Failed to fetch status',
        });
      }
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Network Error',
        description: err.message,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const applyThemeClass = (theme: 'light' | 'dark' | 'system') => {
    if (typeof window === 'undefined') return;
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else if (theme === 'light') {
      root.classList.add('light');
      root.classList.remove('dark');
    } else {
      // System mode
      const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (isSystemDark) {
        root.classList.add('dark');
        root.classList.remove('light');
      } else {
        root.classList.add('light');
        root.classList.remove('dark');
      }
    }
  };

  const handleThemeChange = async (newTheme: 'light' | 'dark' | 'system') => {
    try {
      setUpdatingTheme(true);
      setActiveTheme(newTheme);
      applyThemeClass(newTheme);

      const res = await fetch('/api/admin/security/theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: newTheme }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        toast({
          title: 'Theme Updated',
          description: `Admin theme set to ${newTheme.toUpperCase()}`,
        });
        if (securityState) {
          setSecurityState({ ...securityState, themePreference: newTheme });
        }
      } else {
        toast({
          variant: 'destructive',
          title: 'Theme Update Failed',
          description: data.error,
        });
      }
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err.message,
      });
    } finally {
      setUpdatingTheme(false);
    }
  };

  const handleStartEnrollment = async () => {
    try {
      setEnrollLoading(true);
      setEnrollCode('');
      setIssuedRecoveryPassword(null);
      const res = await fetch('/api/admin/security/2fa/enroll', { method: 'POST' });
      const data = await res.json();

      if (res.ok && data.success) {
        setEnrollSecret(data.secret);
        setEnrollOtpauthUrl(data.otpauthUrl);
        setEnrollModalOpen(true);
      } else {
        toast({
          variant: 'destructive',
          title: 'Enrollment Initialization Failed',
          description: data.error,
        });
      }
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Enrollment Error',
        description: err.message,
      });
    } finally {
      setEnrollLoading(false);
    }
  };

  const handleVerifyEnable = async () => {
    if (!enrollCode || enrollCode.trim().length < 6) {
      toast({
        variant: 'destructive',
        title: 'Code Required',
        description: 'Please enter the 6-digit code from your authenticator app.',
      });
      return;
    }

    try {
      setVerifyingEnable(true);
      const res = await fetch('/api/admin/security/2fa/verify-enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: enrollCode.trim() }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setIssuedRecoveryPassword(data.recoveryPassword);
        toast({
          title: '2FA Authenticator Enabled!',
          description: 'Store your emergency recovery password in a safe location.',
        });
        fetchStatus();
      } else {
        toast({
          variant: 'destructive',
          title: 'Verification Failed',
          description: data.error || 'Invalid 6-digit code',
        });
      }
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Verification Error',
        description: err.message,
      });
    } finally {
      setVerifyingEnable(false);
    }
  };

  const handleDisable2FA = async () => {
    if (!disableCode && !disableRecoveryPassword) {
      toast({
        variant: 'destructive',
        title: 'Input Required',
        description: 'Enter your 6-digit TOTP code or recovery password to disable 2FA.',
      });
      return;
    }

    try {
      setDisabling2FA(true);
      const res = await fetch('/api/admin/security/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: disableCode.trim(),
          recoveryPassword: disableRecoveryPassword.trim(),
        }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        toast({
          title: '2FA Disabled',
          description: 'Authenticator 2FA protection has been turned off.',
        });
        setDisableModalOpen(false);
        setDisableCode('');
        setDisableRecoveryPassword('');
        fetchStatus();
      } else {
        toast({
          variant: 'destructive',
          title: 'Disable Failed',
          description: data.error,
        });
      }
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err.message,
      });
    } finally {
      setDisabling2FA(false);
    }
  };

  const handleEmergencyRecover = async () => {
    if (!recoveryInput || recoveryInput.trim().length < 8) {
      toast({
        variant: 'destructive',
        title: 'Recovery Password Required',
        description: 'Please enter your complete 2FA recovery password.',
      });
      return;
    }

    try {
      setRecovering2FA(true);
      const res = await fetch('/api/admin/security/2fa/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recoveryPassword: recoveryInput.trim() }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setIssuedRecoveryPassword(data.newRecoveryPassword);
        toast({
          title: 'Emergency Recovery Successful',
          description: '2FA has been reset. A fresh recovery password has been generated.',
        });
        setRecoverModalOpen(false);
        setRecoveryInput('');
        fetchStatus();
      } else {
        toast({
          variant: 'destructive',
          title: 'Recovery Failed',
          description: data.error,
        });
      }
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err.message,
      });
    } finally {
      setRecovering2FA(false);
    }
  };

  const copyToClipboard = (text: string, type: 'secret' | 'recovery') => {
    navigator.clipboard.writeText(text);
    if (type === 'secret') {
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    } else {
      setCopiedRecovery(true);
      setTimeout(() => setCopiedRecovery(false), 2000);
    }
    toast({ title: 'Copied to Clipboard' });
  };

  if (loading) {
    return (
      <div className="p-8 text-center space-y-3">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-500" />
        <p className="text-xs text-slate-400">Loading Admin Security Foundation...</p>
      </div>
    );
  }

  const is2FAActive = Boolean(securityState?.is2FAEnabled);

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto text-slate-100">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="w-6 h-6 text-blue-400" />
            <h1 className="text-2xl font-bold tracking-tight text-white">Admin Security Foundation</h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Manage Admin Portal theme appearance, Authenticator 2FA, emergency recovery credentials, and security audit logs.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Badge
            variant={is2FAActive ? 'default' : 'outline'}
            className={
              is2FAActive
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 px-3 py-1 text-xs font-semibold'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/30 px-3 py-1 text-xs font-semibold'
            }
          >
            {is2FAActive ? (
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                2FA ACTIVE
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                2FA INACTIVE
              </span>
            )}
          </Badge>

          <Button
            variant="outline"
            size="sm"
            onClick={fetchStatus}
            className="bg-slate-900 border-slate-700 hover:bg-slate-800 text-xs text-slate-300"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1 text-slate-400" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Grid Section: Theme + 2FA */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. Theme Selection Card */}
        <Card className="bg-slate-900 border-slate-800 text-slate-100 shadow-lg">
          <CardHeader>
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Sun className="w-4 h-4 text-amber-400" />
              Admin Portal Theme Mode
            </CardTitle>
            <CardDescription className="text-xs text-slate-400">
              Select your preferred visual appearance across administrative interfaces.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {/* Light Mode Button */}
              <button
                type="button"
                onClick={() => handleThemeChange('light')}
                disabled={updatingTheme}
                className={`p-3 rounded-xl border flex flex-col items-center justify-center gap-2 text-xs font-medium transition-all ${
                  activeTheme === 'light'
                    ? 'bg-blue-600/15 border-blue-500 text-blue-300 ring-1 ring-blue-500/50'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <Sun className="w-5 h-5 text-amber-400" />
                <span>Light</span>
              </button>

              {/* Dark Mode Button */}
              <button
                type="button"
                onClick={() => handleThemeChange('dark')}
                disabled={updatingTheme}
                className={`p-3 rounded-xl border flex flex-col items-center justify-center gap-2 text-xs font-medium transition-all ${
                  activeTheme === 'dark'
                    ? 'bg-blue-600/15 border-blue-500 text-blue-300 ring-1 ring-blue-500/50'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <Moon className="w-5 h-5 text-indigo-400" />
                <span>Dark</span>
              </button>

              {/* System Mode Button */}
              <button
                type="button"
                onClick={() => handleThemeChange('system')}
                disabled={updatingTheme}
                className={`p-3 rounded-xl border flex flex-col items-center justify-center gap-2 text-xs font-medium transition-all ${
                  activeTheme === 'system'
                    ? 'bg-blue-600/15 border-blue-500 text-blue-300 ring-1 ring-blue-500/50'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <Laptop className="w-5 h-5 text-slate-400" />
                <span>System</span>
              </button>
            </div>

            <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              Theme choice is saved to your administrator profile and active session.
            </p>
          </CardContent>
        </Card>

        {/* 2. Authenticator TOTP 2FA Card */}
        <Card className="bg-slate-900 border-slate-800 text-slate-100 shadow-lg">
          <CardHeader>
            <CardTitle className="text-base text-white flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-blue-400" />
              Authenticator App TOTP 2FA
            </CardTitle>
            <CardDescription className="text-xs text-slate-400">
              Enforce time-based one-time password (TOTP) codes from Google Authenticator, Authy, or 1Password.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-white">Status</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {is2FAActive
                    ? 'Protected with 6-digit Authenticator TOTP'
                    : 'No authenticator app enrolled'}
                </p>
              </div>

              <Badge
                variant={is2FAActive ? 'default' : 'outline'}
                className={
                  is2FAActive
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }
              >
                {is2FAActive ? 'ENABLED' : 'DISABLED'}
              </Badge>
            </div>

            <div className="flex gap-2 pt-1">
              {!is2FAActive ? (
                <Button
                  onClick={handleStartEnrollment}
                  disabled={enrollLoading}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs h-9"
                >
                  {enrollLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                  ) : (
                    <QrCode className="w-3.5 h-3.5 mr-1.5 text-blue-200" />
                  )}
                  Set Up Authenticator 2FA
                </Button>
              ) : (
                <>
                  <Button
                    onClick={handleStartEnrollment}
                    variant="outline"
                    disabled={enrollLoading}
                    className="w-1/2 bg-slate-900 border-slate-700 hover:bg-slate-800 text-slate-200 text-xs h-9"
                  >
                    Re-Enroll App
                  </Button>
                  <Button
                    onClick={() => setDisableModalOpen(true)}
                    variant="destructive"
                    className="w-1/2 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-xs h-9"
                  >
                    Disable 2FA
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 3. Emergency Recovery Password Section */}
      <Card className="bg-slate-900 border-slate-800 text-slate-100 shadow-lg">
        <CardHeader>
          <CardTitle className="text-base text-white flex items-center gap-2">
            <Lock className="w-4 h-4 text-emerald-400" />
            2FA Recovery Password Credentials
          </CardTitle>
          <CardDescription className="text-xs text-slate-400">
            Secure 16-character single-use emergency credential to recover account access if your phone is lost.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {issuedRecoveryPassword ? (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  Save Your 2FA Recovery Password
                </span>
                <Badge variant="outline" className="text-[10px] bg-amber-500/20 text-amber-200 border-amber-500/40">
                  SINGLE USE
                </Badge>
              </div>

              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 font-mono text-sm font-bold text-amber-300 flex items-center justify-between">
                <span>{issuedRecoveryPassword}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => copyToClipboard(issuedRecoveryPassword, 'recovery')}
                  className="h-7 px-2 text-xs text-amber-300 hover:text-white hover:bg-amber-950/40"
                >
                  {copiedRecovery ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </Button>
              </div>

              <p className="text-[11px] text-amber-200/80">
                Keep this code in a password manager. It will NOT be shown again.
              </p>
            </div>
          ) : (
            <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-white">Recovery Password Status</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {securityState?.hasRecoveryPassword
                    ? 'Hashed SHA-256 recovery password stored securely'
                    : 'No recovery password active'}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRecoverModalOpen(true)}
                  className="bg-slate-900 border-slate-700 hover:bg-slate-800 text-xs text-slate-200 h-8"
                >
                  Use Recovery Code
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 4. Audit Log Table */}
      <Card className="bg-slate-900 border-slate-800 text-slate-100 shadow-lg">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base text-white flex items-center gap-2">
              <History className="w-4 h-4 text-purple-400" />
              Admin 2FA Security Audit Trail
            </CardTitle>
            <CardDescription className="text-xs text-slate-400">
              Recent 2FA enrollment, verification, and recovery events.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {auditLogs.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center font-mono italic">
              No recent 2FA security audit logs found.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px]">
                    <th className="py-2.5 px-3">Timestamp</th>
                    <th className="py-2.5 px-3">Action</th>
                    <th className="py-2.5 px-3">IP Address</th>
                    <th className="py-2.5 px-3">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-800/30">
                      <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <Badge
                          variant="outline"
                          className={
                            log.action.includes('ENABLED') || log.action.includes('VERIFIED')
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]'
                              : log.action.includes('FAILED')
                              ? 'bg-rose-500/10 text-rose-400 border-rose-500/30 text-[10px]'
                              : 'bg-blue-500/10 text-blue-400 border-blue-500/30 text-[10px]'
                          }
                        >
                          {log.action}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 text-slate-400">{log.details?.ip_address || 'server-observed'}</td>
                      <td className="py-2.5 px-3 text-slate-400 truncate max-w-xs">
                        {JSON.stringify(log.details || {})}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Enroll Modal */}
      <Dialog open={enrollModalOpen} onOpenChange={setEnrollModalOpen}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg flex items-center gap-2">
              <QrCode className="w-5 h-5 text-blue-400" />
              Scan QR Code in Authenticator App
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Open Google Authenticator or Authy and scan the QR code below.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* QR Code Container */}
            <div className="p-4 bg-white rounded-xl flex items-center justify-center w-48 h-48 mx-auto shadow-inner">
              {enrollOtpauthUrl ? (
                <QRCodeSVG value={enrollOtpauthUrl} size={160} />
              ) : (
                <Loader2 className="w-8 h-8 animate-spin text-slate-800" />
              )}
            </div>

            {/* Secret Key Input */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Manual Setup Secret Key
              </label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={enrollSecret}
                  className="bg-slate-950 border-slate-800 font-mono text-xs text-blue-300"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard(enrollSecret, 'secret')}
                  className="bg-slate-800 border-slate-700 text-slate-200"
                >
                  {copiedSecret ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </Button>
              </div>
            </div>

            {/* Code Verification Input */}
            <div className="space-y-1 pt-2">
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Enter 6-Digit Authenticator Code
              </label>
              <Input
                type="text"
                placeholder="123456"
                maxLength={6}
                value={enrollCode}
                onChange={(e) => setEnrollCode(e.target.value)}
                className="bg-slate-950 border-slate-800 font-mono text-center text-lg tracking-widest text-white h-11"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setEnrollModalOpen(false)}
              className="text-slate-400 hover:text-white text-xs"
            >
              Cancel
            </Button>
            <Button
              onClick={handleVerifyEnable}
              disabled={verifyingEnable || enrollCode.length < 6}
              className="bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs"
            >
              {verifyingEnable ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              Verify & Enable 2FA
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disable Modal */}
      <Dialog open={disableModalOpen} onOpenChange={setDisableModalOpen}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg text-rose-400 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-rose-400" />
              Disable Authenticator 2FA
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Confirm disabling Admin 2FA protection by providing a 6-digit TOTP code or recovery password.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Option A: 6-Digit TOTP Code
              </label>
              <Input
                type="text"
                placeholder="123456"
                maxLength={6}
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value)}
                className="bg-slate-950 border-slate-800 font-mono text-center text-base text-white"
              />
            </div>

            <div className="text-center text-slate-500 font-mono text-xs uppercase">— OR —</div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Option B: 2FA Recovery Password
              </label>
              <Input
                type="text"
                placeholder="pax-rec-XXXX-XXXX-XXXX"
                value={disableRecoveryPassword}
                onChange={(e) => setDisableRecoveryPassword(e.target.value)}
                className="bg-slate-950 border-slate-800 font-mono text-xs text-white"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setDisableModalOpen(false)}
              className="text-slate-400 hover:text-white text-xs"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDisable2FA}
              disabled={disabling2FA || (!disableCode && !disableRecoveryPassword)}
              className="bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs"
            >
              {disabling2FA ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              Confirm Disable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Emergency Recover Modal */}
      <Dialog open={recoverModalOpen} onOpenChange={setRecoverModalOpen}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-amber-400" />
              Emergency 2FA Access Recovery
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Submit your 16-character emergency recovery password to bypass 2FA and reset authenticator setup.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
              Enter 2FA Recovery Password
            </label>
            <Input
              type="text"
              placeholder="pax-rec-XXXX-XXXX-XXXX"
              value={recoveryInput}
              onChange={(e) => setRecoveryInput(e.target.value)}
              className="bg-slate-950 border-slate-800 font-mono text-xs text-amber-300"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setRecoverModalOpen(false)}
              className="text-slate-400 hover:text-white text-xs"
            >
              Cancel
            </Button>
            <Button
              onClick={handleEmergencyRecover}
              disabled={recovering2FA || !recoveryInput}
              className="bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs"
            >
              {recovering2FA ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              Verify Recovery Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
