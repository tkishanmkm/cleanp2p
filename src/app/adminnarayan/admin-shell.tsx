"use client";

import { ReactNode, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { adminSignOut } from "./actions";
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
} from "lucide-react";
import { Logo } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

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

  // If we are on the login page, render children directly without admin shell chrome
  if (pathname === "/adminnarayan/login") {
    return <>{children}</>;
  }

  const navItems = [
    { href: "/adminnarayan/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/adminnarayan/users", label: "Users", icon: Users },
    { href: "/adminnarayan/trades", label: "Trades", icon: ArrowLeftRight },
    {
      href: "/adminnarayan/disputes",
      label: "Disputes",
      icon: ShieldAlert,
      badge: counts.disputes,
      badgeVariant: "destructive" as const,
    },
    { href: "/adminnarayan/wallets", label: "Wallets & Custody", icon: Wallet },
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
    { href: "/adminnarayan/audit-logs", label: "Audit Logs", icon: ClipboardList },
    { href: "/adminnarayan/appearance", label: "Appearance", icon: Brush },
  ];

  const handleSignOut = () => {
    startLogout(async () => {
      await adminSignOut();
    });
  };

  const displayName = adminName || adminEmail?.split("@")[0] || "Administrator";
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "AD";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col md:flex-row">
      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-40">
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
      </header>

      {/* Sidebar Navigation */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 border-r border-slate-800 flex flex-col transition-transform duration-200 ease-in-out md:static md:translate-x-0 ${
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Sidebar Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="font-bold text-sm tracking-tight text-white flex items-center gap-1.5">
                Admin Control
                <Badge variant="destructive" className="text-[9px] px-1 py-0 h-4">
                  PRO
                </Badge>
              </div>
              <p className="text-[11px] text-slate-400">Paxones Core Management</p>
            </div>
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
          {navItems.map((item) => {
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
              <p className="text-[10px] text-slate-400 truncate">{adminEmail || "Super Administrator"}</p>
            </div>
          </div>

          <Button
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
      <main className="flex-1 min-w-0 p-6 md:p-8 overflow-y-auto bg-slate-950">
        <div className="max-w-7xl mx-auto">{children}</div>
      </main>

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
