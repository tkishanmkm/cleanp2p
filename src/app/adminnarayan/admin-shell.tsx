"use client";

import { ReactNode, useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { adminSignOut } from "./actions";
import { createClient } from "@/lib/supabase/client";
import {
  LayoutDashboard,
  Users,
  ArrowLeftRight,
  ShieldAlert,
  Wallet,
  ArrowDownToLine,
  ArrowUpFromLine,
  FileText,
  LifeBuoy,
  Settings,
  Brush,
  ClipboardList,
  LogOut,
  Menu,
  X,
  Shield,
  Loader2,
  Search,
  Gauge,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AdminGlobalSearch } from "@/components/admin/global-search";

interface AdminShellProps {
  children: ReactNode;
  adminEmail?: string;
  adminName?: string;
  counts?: {
    disputes?: number;
    deposits?: number;
    withdrawals?: number;
    tickets?: number;
  };
}

export function AdminShell({
  children,
  adminEmail,
  adminName,
  counts = {},
}: AdminShellProps) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isLoggingOut, startLogout] = useTransition();

  const [authStatus, setAuthStatus] = useState<
    "checking" | "authorized" | "unauthorized" | "unauthenticated" | "verification-unavailable"
  >("checking");
  const [currentUserEmail, setCurrentUserEmail] = useState<string | undefined>(adminEmail);
  const [currentUserName, setCurrentUserName] = useState<string | undefined>(adminName);
  const [supportMode, setSupportMode] = useState<"none" | "readonly" | "emergency">("none");
  const [emergencyExpiresAt, setEmergencyExpiresAt] = useState<string | null>(null);
  const [emergencyUsesRemaining, setEmergencyUsesRemaining] = useState<number | null>(null);
  const [isActivatingEmergency, setIsActivatingEmergency] = useState(false);
  const [isEmergencyDialogOpen, setIsEmergencyDialogOpen] = useState(false);
  const [emergencyCode, setEmergencyCode] = useState("");
  const [emergencyActionError, setEmergencyActionError] = useState<string | null>(null);
  const [supportTargetUserId, setSupportTargetUserId] = useState("");
  const [supportRestrictionReason, setSupportRestrictionReason] = useState("");
  const [isRestrictingUser, setIsRestrictingUser] = useState(false);
  const [supportRestrictionMessage, setSupportRestrictionMessage] = useState<string | null>(null);

  // If we are on the login page, render children directly without admin shell chrome
  const isLoginPage = pathname === "/adminnarayan/login";

  useEffect(() => {
    if (isLoginPage) return;

    let isMounted = true;
    async function verifyClientAdmin() {
      try {
        const supabase = createClient();
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) {
          if (isMounted) setAuthStatus("verification-unavailable");
          return;
        }
        if (!user) {
          if (isMounted) setAuthStatus("unauthenticated");
          return;
        }

        const { data: verificationResult, error: rpcError } = await supabase.rpc(
          "verify_admin_login",
          { user_uuid: user.id }
        );

        if (rpcError || verificationResult?.[0]?.is_valid !== true) {
          // Support admins are intentionally not full admins in verify_admin_login.
          // A server endpoint separately verifies their read-only grant or active emergency session.
          try {
            const supportResponse = await fetch("/api/admin/support-admins/status", { cache: "no-store" });
            const supportStatus = await supportResponse.json().catch(() => null);
            if (supportResponse.ok && supportStatus?.success === true && supportStatus?.isSupportAdmin === true) {
              if (isMounted) {
                setCurrentUserEmail(user.email);
                setCurrentUserName(
                  (user.user_metadata?.full_name as string) || user.email?.split("@")[0] || "Support Admin"
                );
                setSupportMode(supportStatus.emergencyActive ? "emergency" : "readonly");
                setEmergencyExpiresAt(supportStatus.emergencyExpiresAt || null);
                setEmergencyUsesRemaining(Number.isInteger(supportStatus.usesRemaining) ? supportStatus.usesRemaining : null);
                setAuthStatus("authorized");
              }
              return;
            }
          } catch {}

          if (isMounted) setAuthStatus(rpcError ? "verification-unavailable" : "unauthorized");
          return;
        }

        if (isMounted) {
          setCurrentUserEmail(user.email);
          setCurrentUserName(
            (user.user_metadata?.full_name as string) ||
            user.email?.split("@")[0] ||
            "Administrator"
          );
          setSupportMode("none");
          setEmergencyExpiresAt(null);
          setEmergencyUsesRemaining(null);
          setAuthStatus("authorized");
        }
      } catch {
        if (isMounted) setAuthStatus("verification-unavailable");
      }
    }

    verifyClientAdmin();
    return () => {
      isMounted = false;
    };
  }, [isLoginPage]);

  if (isLoginPage) {
    return <>{children}</>;
  }

  const handleSignOut = () => {
    startLogout(async () => {
      try {
        const supabase = createClient();
        await supabase.auth.signOut();
      } catch {}
      await adminSignOut();
      window.location.href = "/adminnarayan/login";
    });
  };

  const handleEmergencyActivation = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    setEmergencyActionError(null);
    setIsActivatingEmergency(true);
    try {
      const response = await fetch("/api/admin/support-admins/emergency/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: emergencyCode }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.success !== true) {
        setEmergencyActionError(result?.error || "Emergency mode could not be activated.");
        return;
      }
      setSupportMode("emergency");
      setEmergencyExpiresAt(result.expiresAt || null);
      setEmergencyUsesRemaining(Number.isInteger(result.usesRemaining) ? result.usesRemaining : null);
      setEmergencyCode("");
      setIsEmergencyDialogOpen(false);
      window.location.reload();
    } catch {
      setEmergencyActionError("Emergency mode could not be activated. Please retry.");
    } finally {
      setIsActivatingEmergency(false);
    }
  };

  const handleSupportRestriction = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    setSupportRestrictionMessage(null);
    setIsRestrictingUser(true);
    try {
      const response = await fetch("/api/admin/support-admins/restrict-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: supportTargetUserId.trim(), reason: supportRestrictionReason.trim() }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.success !== true) {
        setSupportRestrictionMessage(result?.error || "Restriction review request could not be submitted.");
        return;
      }
      setSupportRestrictionMessage(result?.message || "Restriction review request logged for full-administrator review. No account changes were made.");
      setSupportTargetUserId("");
      setSupportRestrictionReason("");
    } catch {
      setSupportRestrictionMessage("Restriction review request could not be submitted. Please retry.");
    } finally {
      setIsRestrictingUser(false);
    }
  };

  if (authStatus === "checking") {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-slate-300">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-3" />
        <p className="text-sm text-slate-400">Verifying administrative access...</p>
      </div>
    );
  }

  if (authStatus === "unauthenticated") {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-slate-300">
        <div className="w-full max-w-md p-6 bg-slate-900 border border-slate-800 rounded-xl text-center space-y-4 shadow-xl">
          <div className="w-12 h-12 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-white">Administrator Access Required</h2>
            <p className="text-sm text-slate-400">
              Please sign in with your administrator credentials to access the management portal.
            </p>
          </div>
          <div className="pt-2 flex flex-col gap-2">
            <Button
              id="admin-shell-login-btn"
              onClick={() => {
                window.location.href = `/adminnarayan/login?redirectTo=${encodeURIComponent(pathname)}`;
              }}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white"
            >
              Sign In to Admin Portal
            </Button>
            <Button
              id="admin-shell-home-btn"
              variant="ghost"
              onClick={() => {
                window.location.href = "/";
              }}
              className="w-full text-slate-400 hover:text-white"
            >
              Return to Marketplace
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (authStatus === "verification-unavailable") {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-slate-300">
        <div className="w-full max-w-md p-6 bg-slate-900 border border-amber-900/50 rounded-xl text-center space-y-4 shadow-xl">
          <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-white">Admin Verification Unavailable</h2>
          <p className="text-sm text-slate-400">
            Administrator access could not be verified. Protected controls remain locked. Please retry or sign in again.
          </p>
          <Button
            id="admin-shell-retry-verification-btn"
            onClick={() => window.location.reload()}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white"
          >
            Retry Verification
          </Button>
          <Button
            id="admin-shell-verification-login-btn"
            variant="ghost"
            onClick={() => { window.location.href = "/adminnarayan/login"; }}
            className="w-full text-slate-400 hover:text-white"
          >
            Return to Admin Login
          </Button>
        </div>
      </div>
    );
  }

  if (authStatus === "unauthorized") {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-slate-300">
        <div className="w-full max-w-md p-6 bg-slate-900 border border-red-900/50 rounded-xl text-center space-y-4 shadow-xl">
          <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center mx-auto">
            <Shield className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-white">Access Denied</h2>
            <p className="text-sm text-slate-400">
              The currently logged-in account does not possess administrator privileges.
            </p>
          </div>
          <div className="pt-2 flex flex-col gap-2">
            <Button
              id="admin-shell-switch-account-btn"
              onClick={handleSignOut}
              className="w-full bg-red-600 hover:bg-red-500 text-white"
            >
              Sign Out & Switch Account
            </Button>
            <Button
              id="admin-shell-unauth-home-btn"
              variant="ghost"
              onClick={() => {
                window.location.href = "/";
              }}
              className="w-full text-slate-400 hover:text-white"
            >
              Return to Marketplace
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const navItems = [
    { href: "/adminnarayan/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/adminnarayan/search", label: "Global Search", icon: Search },
    { href: "/adminnarayan/users", label: "Users", icon: Users },
    { href: "/adminnarayan/merchants", label: "Merchant Tiers", icon: Shield },
    { href: "/adminnarayan/trades", label: "Trades", icon: ArrowLeftRight },
    {
      href: "/adminnarayan/disputes",
      label: "Disputes",
      icon: ShieldAlert,
      badge: counts.disputes,
      badgeVariant: "destructive" as const,
    },
    { href: "/adminnarayan/wallets", label: "Wallets & Custody", icon: Wallet },
    { href: "/adminnarayan/operations", label: "Operations & Solvency", icon: Gauge },
    { href: "/adminnarayan/wallet", label: "Main Wallet Queue", icon: Wallet },
    {
      href: "/adminnarayan/deposits",
      label: "Deposits",
      icon: ArrowDownToLine,
      badge: counts.deposits,
      badgeVariant: "default" as const,
    },
    {
      href: "/adminnarayan/withdrawals",
      label: "Withdrawals",
      icon: ArrowUpFromLine,
      badge: counts.withdrawals,
      badgeVariant: "default" as const,
    },
    { href: "/adminnarayan/ads", label: "P2P Ads", icon: FileText },
    {
      href: "/adminnarayan/support",
      label: "Support Tickets",
      icon: LifeBuoy,
      badge: counts.tickets,
      badgeVariant: "secondary" as const,
    },
    { href: "/adminnarayan/settings", label: "Platform Settings", icon: Settings },
    { href: "/adminnarayan/security", label: "Security & 2FA", icon: Shield },
    { href: "/adminnarayan/support-admins", label: "Support Admins", icon: Users },
    { href: "/adminnarayan/audit-logs", label: "Audit Logs", icon: ClipboardList },
    { href: "/adminnarayan/appearance", label: "Appearance", icon: Brush },
  ];

  const displayName = currentUserName || currentUserEmail?.split("@")[0] || "Administrator";
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "AD";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col md:flex-row">
      {/* Mobile Header */}
      <header className="md:hidden flex flex-col px-4 py-2.5 border-b border-slate-800 bg-slate-900/95 backdrop-blur sticky top-0 z-40 gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Logo />
            <Badge variant="destructive" className="text-[10px] px-1.5 py-0.5 uppercase tracking-wider font-semibold">
              Admin
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="text-slate-300 hover:text-white"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
        <div className="w-full">
          <AdminGlobalSearch />
        </div>
      </header>

      {/* Sidebar Navigation */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 border-r border-slate-800 flex flex-col transition-transform duration-200 ease-in-out md:static md:translate-x-0 ${
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Sidebar Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/" title="Back to Marketplace" className="shrink-0">
              <Logo variant="desktop" priority />
            </Link>
            <Badge variant="destructive" className="text-[9px] px-1.5 py-0.5 h-4 uppercase font-semibold">
              Admin
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileMenuOpen(false)}
            className="md:hidden text-slate-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {navItems.filter((item) => supportMode === "none" || item.href !== "/adminnarayan/support-admins").map((item) => {
            const isActive =
              item.href === "/adminnarayan/dashboard"
                ? pathname === "/adminnarayan/dashboard" || pathname === "/adminnarayan"
                : pathname.startsWith(item.href);

            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-slate-800 text-white shadow-sm border border-slate-700/80 font-semibold"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon className={`h-4 w-4 shrink-0 ${isActive ? "text-amber-400" : "text-slate-500"}`} />
                  <span className="truncate">{item.label}</span>
                </div>
                {item.badge !== undefined && item.badge > 0 && (
                  <Badge
                    variant={item.badgeVariant || "secondary"}
                    className="ml-auto text-[10px] px-1.5 py-0 h-4 min-w-4 flex items-center justify-center font-bold"
                  >
                    {item.badge}
                  </Badge>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="p-3 border-t border-slate-800 bg-slate-900/50">
          <div className="flex items-center gap-2.5 px-2 py-2 mb-2 rounded-lg bg-slate-800/60 border border-slate-700/50">
            <Avatar className="h-8 w-8 rounded-md bg-slate-700 text-slate-200 border border-slate-600">
              <AvatarFallback className="text-xs font-bold bg-slate-800 text-amber-300">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-slate-200 truncate">{displayName}</p>
              <p className="text-[10px] text-slate-400 truncate">{currentUserEmail || "Super Administrator"}</p>
            </div>
          </div>

          <Button
            id="admin-sidebar-signout-btn"
            variant="outline"
            size="sm"
            onClick={handleSignOut}
            disabled={isLoggingOut}
            className="w-full text-xs font-medium text-slate-300 border-slate-700 bg-slate-800/60 hover:bg-red-950/40 hover:text-red-300 hover:border-red-900/50 transition-colors"
          >
            {isLoggingOut ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <LogOut className="mr-2 h-3.5 w-3.5 text-slate-400" />
            )}
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main View Area */}
      <div className="flex-1 min-w-0 flex flex-col min-h-screen overflow-hidden bg-slate-950">
        {/* Desktop Top Header */}
        <header className="hidden md:flex items-center justify-between px-8 py-3 border-b border-slate-800/80 bg-slate-900/60 backdrop-blur sticky top-0 z-30">
          <div className="flex-1 max-w-md">
            <AdminGlobalSearch />
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-emerald-400 bg-emerald-950/40 px-2.5 py-1 rounded-full border border-emerald-800/60 font-mono text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live Ledger Connected
            </div>
          </div>
        </header>

        <main className="flex-1 p-6 md:p-8 overflow-y-auto">
          <div className="max-w-7xl mx-auto">
            {supportMode === "readonly" && (
              <section className="mb-5 rounded-xl border border-sky-700/60 bg-sky-950/40 p-4 text-sky-100" role="status">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="font-semibold">Support Admin — View-only mode</h2>
                    <p className="mt-1 text-sm text-sky-200">You can inspect platform data, but administrative changes are locked. Emergency mode requires a fresh authenticator code and an available use.</p>
                    {emergencyUsesRemaining !== null && <p className="mt-1 text-xs text-sky-300">Emergency uses remaining: {emergencyUsesRemaining}</p>}
                  </div>
                  <Button type="button" onClick={() => { setEmergencyActionError(null); setEmergencyCode(""); setIsEmergencyDialogOpen(true); }} className="shrink-0 bg-amber-500 text-slate-950 hover:bg-amber-400">
                    Activate Emergency Mode
                  </Button>
                </div>
                <form onSubmit={handleSupportRestriction} className="mt-4 grid grid-cols-1 gap-3 border-t border-sky-800/70 pt-4 md:grid-cols-3">
                  <label className="block text-xs text-sky-200 md:col-span-1">Request review for user UUID
                    <input required value={supportTargetUserId} onChange={(event) => setSupportTargetUserId(event.target.value)} className="mt-1 w-full rounded-md border border-sky-800 bg-slate-950 px-3 py-2 text-sm text-white" placeholder="Target user UUID" />
                  </label>
                  <label className="block text-xs text-sky-200 md:col-span-1">Reason (optional)
                    <input value={supportRestrictionReason} maxLength={2000} onChange={(event) => setSupportRestrictionReason(event.target.value)} className="mt-1 w-full rounded-md border border-sky-800 bg-slate-950 px-3 py-2 text-sm text-white" placeholder="Reason for review request" />
                  </label>
                  <div className="flex items-end"><Button type="submit" disabled={isRestrictingUser || !supportTargetUserId.trim()} variant="outline" className="w-full border-sky-700 text-sky-100 hover:bg-sky-900">{isRestrictingUser ? "Submitting request…" : "Request Restriction Review"}</Button></div>
                </form>
                {supportRestrictionMessage && <p className="mt-3 text-sm text-sky-100" role="status">{supportRestrictionMessage}</p>}
              </section>
            )}
            {supportMode === "emergency" && (
              <section className="mb-5 rounded-xl border border-amber-600/70 bg-amber-950/50 p-4 text-amber-100" role="status">
                <h2 className="font-semibold">Emergency mode active</h2>
                <p className="mt-1 text-sm">Privileged actions are enabled temporarily and audited. Session expiry: {emergencyExpiresAt ? new Date(emergencyExpiresAt).toLocaleString() : "within three hours of activation"}.</p>
              </section>
            )}
            {isEmergencyDialogOpen && (
              <section className="mb-5 max-w-xl rounded-xl border border-amber-700/60 bg-slate-900 p-4" role="dialog" aria-modal="true" aria-labelledby="support-emergency-title">
                <h2 id="support-emergency-title" className="font-semibold text-white">Verify emergency activation</h2>
                <p className="mt-1 text-sm text-slate-300">Enter the current authenticator code. One assigned emergency use will be consumed, and access expires after three hours.</p>
                <form onSubmit={handleEmergencyActivation} className="mt-4 space-y-3">
                  <label htmlFor="support-emergency-totp" className="block text-sm text-slate-200">6-digit authenticator code</label>
                  <input id="support-emergency-totp" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={emergencyCode} onChange={(event) => setEmergencyCode(event.target.value.replace(/\D/g, "").slice(0, 6))} className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-white" />
                  {emergencyActionError && <p className="text-sm text-red-300" role="alert">{emergencyActionError}</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={isActivatingEmergency || emergencyCode.length !== 6} className="bg-amber-500 text-slate-950 hover:bg-amber-400">{isActivatingEmergency ? "Verifying…" : "Verify & Activate"}</Button>
                    <Button type="button" variant="outline" disabled={isActivatingEmergency} onClick={() => { setIsEmergencyDialogOpen(false); setEmergencyCode(""); setEmergencyActionError(null); }}>Cancel</Button>
                  </div>
                </form>
              </section>
            )}
            <div data-support-read-only={supportMode === "readonly" ? "true" : "false"}>{children}</div>
          </div>
        </main>
      </div>

      {/* Backdrop for mobile menu */}
      {mobileMenuOpen && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 md:hidden"
        />
      )}
    </div>
  );
}
