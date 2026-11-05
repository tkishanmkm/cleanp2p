"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  ShieldAlert,
  AlertTriangle,
  Lock,
  Unlock,
  RefreshCw,
  Power,
  Flame,
  UserX,
  UserCheck,
  PauseCircle,
  PlayCircle,
  Trash2,
  Users,
  Ban,
  Clock,
  CheckCircle2,
  XCircle,
  Percent,
  DollarSign,
  Save,
  HelpCircle,
  Eye,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { updateAppSettingsAction, updateWithdrawalGovernanceAction } from "./actions";

interface PlatformSettingsState {
  emergency_mode: boolean;
  prevent_new_trades: boolean;
  prevent_withdrawals: boolean;
  prevent_transfers: boolean;
  prevent_new_ads: boolean;
  prevent_user_login: boolean;
  prevent_new_signups: boolean;
  maintenance_mode: boolean;
  all_ads_paused_at?: string | null;
  updated_at: string;
}

interface UserBlockItem {
  id: string;
  blockerId: string;
  blockedId: string;
  blockerUsername: string;
  blockerEmail: string;
  blockedUsername: string;
  blockedEmail: string;
  createdAt: string;
  isActive: boolean;
}

interface Props {
  initialSettings: PlatformSettingsState;
  appSettings: {
    platform_fee_percent: number;
    escrow_fee_percent: number;
    min_trade_amount: number;
  };
  withdrawalGovernance?: {
    max_single_withdrawal_usd: number;
    withdrawal_approval_threshold_usd: number;
    daily_withdrawal_limit_usd: number;
    password_change_withdrawal_hold_hours: number;
    withdrawal_fee_multiplier: number;
  };
}

interface ControlConfig {
  key: keyof Omit<PlatformSettingsState, "all_ads_paused_at" | "updated_at">;
  title: string;
  description: string;
  dangerLevel: "Emergency" | "Critical" | "High" | "Medium";
  enableConfirmation: string;
  disableConfirmation: string;
  icon: React.ReactNode;
}

const CONTROLS: ControlConfig[] = [
  {
    key: "emergency_mode",
    title: "Master Emergency Mode",
    description: "GLOBAL MASTER KILL-SWITCH. Immediately suspends new P2P trades, withdrawals, transfers, advertisement creation, and new user logins, while allowing qualifying active trades to continue safely until completion. Overrides all individual controls.",
    dangerLevel: "Emergency",
    enableConfirmation: "CRITICAL: Enabling Master Emergency Mode stops new platform activity. New trades, withdrawals, transfers, ads, and new logins will be halted across all database boundaries. Qualifying active trades will be permitted to continue until completion, after which participating users are restricted. Type confirmation to proceed.",
    disableConfirmation: "Master Emergency Mode will be deactivated. Platform operations will revert to their individual switchboard settings.",
    icon: <ShieldAlert className="w-5 h-5 text-red-500 animate-pulse" />,
  },
  {
    key: "maintenance_mode",
    title: "Maintenance Mode",
    description: "Blocks ordinary users without qualifying active trades. Users with active trades can continue only allowed trade/dispute flows until completion.",
    dangerLevel: "Emergency",
    enableConfirmation: "Ordinary users without qualifying active trades will be blocked from accessing the platform. Users with active trades may continue only the allowed trade/chat/dispute flows until completion. Admin access remains intact.",
    disableConfirmation: "Maintenance mode will be deactivated. Normal platform access will be restored for all users.",
    icon: <Flame className="w-5 h-5 text-amber-500" />,
  },
  {
    key: "prevent_new_trades",
    title: "Prevent New Trades",
    description: "Prevents any new P2P trades from being initiated across the entire marketplace. Existing trades remain unaffected and can complete.",
    dangerLevel: "High",
    enableConfirmation: "No new P2P trades can be initiated while this control is enabled. Existing trades can still complete normally.",
    disableConfirmation: "New trade creation will be re-enabled for all platform users.",
    icon: <Lock className="w-5 h-5 text-red-400" />,
  },
  {
    key: "prevent_withdrawals",
    title: "Prevent Withdrawals",
    description: "Blocks new withdrawal requests and halts outgoing withdrawal processing. Existing on-chain settlements remain safe.",
    dangerLevel: "Critical",
    enableConfirmation: "New withdrawal requests/processing will be blocked according to the server-side withdrawal guard. Existing settlement processing remains safe.",
    disableConfirmation: "Withdrawal requests and processing will be resumed.",
    icon: <ShieldAlert className="w-5 h-5 text-rose-500" />,
  },
  {
    key: "prevent_transfers",
    title: "Prevent Internal Transfers",
    description: "Blocks all off-chain internal account-to-account transfers between platform users.",
    dangerLevel: "Medium",
    enableConfirmation: "New internal transfers will be blocked across all user accounts.",
    disableConfirmation: "Internal transfers between users will be re-enabled.",
    icon: <Power className="w-5 h-5 text-orange-400" />,
  },
  {
    key: "prevent_new_ads",
    title: "Prevent New Advertisements",
    description: "Prevents users from publishing new buy or sell offers. Existing live ads are not automatically deleted.",
    dangerLevel: "Medium",
    enableConfirmation: "Users will not be able to create new advertisements. Existing ads are not automatically deleted.",
    disableConfirmation: "Users will be able to create new marketplace advertisements.",
    icon: <AlertTriangle className="w-5 h-5 text-yellow-400" />,
  },
  {
    key: "prevent_user_login",
    title: "Prevent User Login",
    description: "Blocks all non-admin authentication sessions. Administrator access to /adminnarayan remains fully operational.",
    dangerLevel: "Critical",
    enableConfirmation: "Ordinary users will not be allowed to log in while this control is enabled. Admin access remains available.",
    disableConfirmation: "User login functionality will be restored for all normal accounts.",
    icon: <UserX className="w-5 h-5 text-purple-400" />,
  },
  {
    key: "prevent_new_signups",
    title: "Prevent New Signups",
    description: "Blocks new user registration and account creation across all onboarding flows.",
    dangerLevel: "High",
    enableConfirmation: "New account registration will be blocked. Existing registered users can still use their accounts.",
    disableConfirmation: "New user signups and account registration will be reopened.",
    icon: <Ban className="w-5 h-5 text-blue-400" />,
  },
];

export default function PlatformSettingsSwitchboard({
  initialSettings,
  appSettings,
  withdrawalGovernance = {
    max_single_withdrawal_usd: 4000.0,
    withdrawal_approval_threshold_usd: 2000.0,
    daily_withdrawal_limit_usd: 10000.0,
    password_change_withdrawal_hold_hours: 24.0,
    withdrawal_fee_multiplier: 2.0,
  },
}: Props) {
  const [settings, setSettings] = useState<PlatformSettingsState>(initialSettings);
  const [loading, setLoading] = useState(false);
  const [isSavingAppSettings, setIsSavingAppSettings] = useState(false);
  const [isSavingWithdrawalGovernance, setIsSavingWithdrawalGovernance] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  // Confirmation Modal state
  const [pendingToggle, setPendingToggle] = useState<{
    key: keyof Omit<PlatformSettingsState, "all_ads_paused_at" | "updated_at">;
    nextValue: boolean;
    config: ControlConfig;
  } | null>(null);
  const [toggleReason, setToggleReason] = useState("");
  const [isSubmittingToggle, setIsSubmittingToggle] = useState(false);

  // Bulk action confirmation state
  const [bulkModal, setBulkModal] = useState<{
    action: string;
    title: string;
    description: string;
    dangerLevel: "Emergency" | "Critical" | "High" | "Medium";
    requiresPhrase?: string;
  } | null>(null);
  const [typedPhrase, setTypedPhrase] = useState("");
  const [isExecutingBulk, setIsExecutingBulk] = useState(false);

  // User blocks state
  const [userBlocks, setUserBlocks] = useState<UserBlockItem[]>([]);
  const [loadingBlocks, setLoadingBlocks] = useState(false);
  const [unblockModal, setUnblockModal] = useState<UserBlockItem | null>(null);
  const [isUnblocking, setIsUnblocking] = useState(false);

  // Active restrictions list
  const activeRestrictions = CONTROLS.filter((c) => Boolean(settings[c.key]));

  // Fetch canonical settings from server
  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/platform-settings", { cache: "no-store" });
      const data = await res.json();
      if (data.success && data.settings) {
        setSettings(data.settings);
      } else if (data.settings) {
        setSettings(data.settings);
      }
    } catch (err: any) {
      console.error("Failed to refresh settings:", err);
      setFeedback({ type: "error", message: "Failed to fetch latest platform settings from server." });
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch user blocks
  const fetchUserBlocks = useCallback(async () => {
    setLoadingBlocks(true);
    try {
      const res = await fetch("/api/admin/user-blocks", { cache: "no-store" });
      const data = await res.json();
      if (data.success && Array.isArray(data.blocks)) {
        setUserBlocks(data.blocks);
      }
    } catch (err: any) {
      console.error("Failed to fetch user blocks:", err);
    } finally {
      setLoadingBlocks(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    fetchUserBlocks();
  }, [fetchSettings, fetchUserBlocks]);

  // Handle toggle initiation
  const handleToggleClick = (config: ControlConfig) => {
    const currentValue = Boolean(settings[config.key]);
    const nextValue = !currentValue;
    setToggleReason("");
    setPendingToggle({
      key: config.key,
      nextValue,
      config,
    });
  };

  // Confirm toggle execution
  const confirmToggle = async () => {
    if (!pendingToggle) return;
    setIsSubmittingToggle(true);
    setFeedback(null);

    const { key, nextValue } = pendingToggle;

    try {
      const res = await fetch("/api/admin/platform-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [key]: nextValue,
          reason: toggleReason || "Manual toggle by administrator",
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Server rejected the setting change.");
      }

      // Update state authoritatively from server response
      if (data.settings) {
        setSettings(data.settings);
      } else {
        setSettings((prev) => ({ ...prev, [key]: nextValue }));
      }

      setFeedback({
        type: "success",
        message: `Successfully ${nextValue ? "enabled" : "disabled"} ${pendingToggle.config.title}.`,
      });
      setPendingToggle(null);
    } catch (err: any) {
      console.error("Error updating platform control:", err);
      setFeedback({
        type: "error",
        message: `Failed to update ${pendingToggle.config.title}: ${err.message}`,
      });
      // Invalidate and refresh to ensure UI accurately reflects database
      await fetchSettings();
    } finally {
      setIsSubmittingToggle(false);
    }
  };

  // Execute Bulk Action
  const executeBulkAction = async () => {
    if (!bulkModal) return;
    if (bulkModal.requiresPhrase && typedPhrase.trim() !== bulkModal.requiresPhrase) {
      setFeedback({ type: "error", message: `Please type '${bulkModal.requiresPhrase}' exactly to confirm.` });
      return;
    }

    setIsExecutingBulk(true);
    setFeedback(null);

    try {
      const res = await fetch("/api/admin/platform-controls/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: bulkModal.action }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to execute bulk operation.");
      }

      setFeedback({
        type: "success",
        message: data.message || `Bulk operation '${bulkModal.title}' executed successfully.`,
      });
      setBulkModal(null);
      setTypedPhrase("");
      await fetchSettings();
    } catch (err: any) {
      console.error("Bulk action failed:", err);
      setFeedback({
        type: "error",
        message: `Bulk action failed: ${err.message}`,
      });
    } finally {
      setIsExecutingBulk(false);
    }
  };

  // Execute Admin Unblock
  const executeAdminUnblock = async () => {
    if (!unblockModal) return;
    setIsUnblocking(true);
    try {
      const res = await fetch("/api/admin/user-blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blockId: unblockModal.id,
          blockerId: unblockModal.blockerId,
          blockedId: unblockModal.blockedId,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to unblock user.");
      }

      setFeedback({
        type: "success",
        message: `Successfully unblocked relationship between ${unblockModal.blockerUsername} and ${unblockModal.blockedUsername}.`,
      });
      setUnblockModal(null);
      await fetchUserBlocks();
    } catch (err: any) {
      setFeedback({ type: "error", message: `Unblock error: ${err.message}` });
    } finally {
      setIsUnblocking(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header & Refresh */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
            <ShieldAlert className="w-8 h-8 text-amber-400" />
            Global Platform Switchboard & Emergency Controls
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Authoritative, real-time control panel backed by <code className="text-amber-400/90 font-mono text-xs">public.system_settings</code>.
          </p>
        </div>
        <button
          onClick={() => {
            fetchSettings();
            fetchUserBlocks();
          }}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-lg border border-slate-700 transition-colors shadow-sm disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-blue-400" : ""}`} />
          {loading ? "Refreshing State..." : "Sync Fresh State"}
        </button>
      </div>

      {/* Global Alert / Feedback Banner */}
      {feedback && (
        <div
          className={`p-4 rounded-lg border flex items-start justify-between gap-3 text-sm animate-in fade-in duration-200 ${
            feedback.type === "success"
              ? "bg-emerald-950/70 border-emerald-800/80 text-emerald-200"
              : feedback.type === "error"
              ? "bg-rose-950/70 border-rose-800/80 text-rose-200"
              : "bg-blue-950/70 border-blue-800/80 text-blue-200"
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === "success" ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : (
              <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-white text-xs font-semibold px-2 py-0.5 rounded bg-slate-900/60"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Master Emergency Mode Alert Banner */}
      {settings.emergency_mode && (
        <div className="p-5 rounded-xl border-2 border-red-600 bg-red-950/80 text-white flex items-start gap-4 shadow-2xl animate-pulse">
          <ShieldAlert className="w-8 h-8 text-red-500 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h3 className="text-lg font-bold tracking-tight text-red-200">
              MASTER EMERGENCY MODE IS ACTIVE
            </h3>
            <p className="text-sm text-red-100">
              Emergency Mode blocks new platform activity while allowing qualifying active trades to continue safely. All new P2P trades, withdrawals, internal transfers, advertisement creation, and new user signups/logins are strictly suspended across all database boundaries and API services.
            </p>
            <p className="text-xs text-red-300 font-mono pt-1">
              Active Trade Policy: Qualifying active trades are permitted to complete safely. Normal users without active trades are restricted.
            </p>
          </div>
        </div>
      )}

      {/* Active Restrictions Warning Banner */}
      {activeRestrictions.length > 0 ? (
        <div className="p-4 rounded-xl border border-rose-700/80 bg-rose-950/40 text-rose-200 flex items-start gap-3 shadow-lg">
          <ShieldAlert className="w-6 h-6 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-white">Platform restrictions currently active ({activeRestrictions.length}):</p>
            <ul className="list-disc list-inside text-sm space-y-0.5 text-rose-300">
              {activeRestrictions.map((ctrl) => (
                <li key={ctrl.key}>
                  <strong className="text-white">{ctrl.title}</strong> — {ctrl.dangerLevel} level lock
                </li>
              ))}
            </ul>
            <p className="text-xs text-rose-400/90 pt-1">
              Admin portal (<code className="font-mono text-rose-300">/adminnarayan</code>) and legitimate administrative recovery remain operational.
            </p>
          </div>
        </div>
      ) : (
        <div className="p-3 rounded-lg border border-emerald-800/50 bg-emerald-950/20 text-emerald-300 text-xs flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>All 8 global platform switches are currently in normal operational state (All OFF). Marketplace is unrestricted.</span>
        </div>
      )}

      {/* 1. CANONICAL GLOBAL SWITCHES */}
      <Card className="bg-slate-900 border-slate-800 shadow-md">
        <CardHeader className="border-b border-slate-800/80 pb-4">
          <CardTitle className="text-white text-lg flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Power className="w-5 h-5 text-amber-400" /> Canonical Global Platform Controls (8)
            </span>
            <span className="text-xs font-normal text-slate-400 font-mono">
              Last synced: {new Date(settings.updated_at).toLocaleTimeString()}
            </span>
          </CardTitle>
          <CardDescription className="text-slate-400 text-xs">
            Toggle global feature gates. Every state alteration is verified against the database and logged to the admin audit trail.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {CONTROLS.map((ctrl) => {
              const isEnabled = Boolean(settings[ctrl.key]);
              const dangerBadge =
                ctrl.dangerLevel === "Emergency"
                  ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                  : ctrl.dangerLevel === "Critical"
                  ? "bg-red-500/20 text-red-300 border-red-500/40"
                  : ctrl.dangerLevel === "High"
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : "bg-blue-500/20 text-blue-300 border-blue-500/40";

              return (
                <div
                  key={ctrl.key}
                  className={`p-4 rounded-xl border transition-all flex flex-col justify-between gap-4 ${
                    isEnabled
                      ? "bg-rose-950/20 border-rose-800/60 shadow-inner"
                      : "bg-slate-950/60 border-slate-800/80 hover:border-slate-700"
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {ctrl.icon}
                        <h3 className="text-sm font-semibold text-white">{ctrl.title}</h3>
                      </div>
                      <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${dangerBadge}`}>
                        {ctrl.dangerLevel}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">{ctrl.description}</p>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-800/60">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${
                          isEnabled ? "bg-rose-500 animate-pulse shadow-rose-500/50 shadow-sm" : "bg-slate-600"
                        }`}
                      />
                      <span className={`text-xs font-mono font-bold ${isEnabled ? "text-rose-400" : "text-slate-400"}`}>
                        {isEnabled ? "ACTIVE (BLOCKED)" : "NORMAL (OPEN)"}
                      </span>
                    </div>

                    <button
                      onClick={() => handleToggleClick(ctrl)}
                      disabled={loading || isSubmittingToggle}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border shadow-sm flex items-center gap-1.5 ${
                        isEnabled
                          ? "bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500"
                          : "bg-rose-700 hover:bg-rose-600 text-white border-rose-600"
                      }`}
                    >
                      {isEnabled ? (
                        <>
                          <Unlock className="w-3.5 h-3.5" /> Deactivate
                        </>
                      ) : (
                        <>
                          <Lock className="w-3.5 h-3.5" /> Enable Lock
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* 2. EMERGENCY BULK PLATFORM CONTROLS */}
      <Card className="bg-slate-900 border-slate-800 shadow-md">
        <CardHeader className="border-b border-slate-800/80 pb-4">
          <CardTitle className="text-white text-lg flex items-center gap-2">
            <Flame className="w-5 h-5 text-rose-400" /> Emergency Bulk Platform Actions
          </CardTitle>
          <CardDescription className="text-slate-400 text-xs">
            High-impact administrative commands. All operations exclude administrators, preserve active trade escrow balances, and create auditable records.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 space-y-6">
          {/* Ad Operations */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3 flex items-center gap-2">
              <PauseCircle className="w-4 h-4 text-amber-400" /> Bulk Advertisement Actions
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                onClick={() =>
                  setBulkModal({
                    action: "pause_all_ads",
                    title: "Pause ALL Advertisements",
                    description: "This will set all currently active advertisements across public.ads and public.p2p_ads to GLOBAL_PAUSED. No ads will be deleted. Offers can be resumed later.",
                    dangerLevel: "High",
                  })
                }
                className="p-3 bg-slate-950 border border-amber-900/40 hover:border-amber-700 text-amber-300 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all hover:bg-amber-950/20"
              >
                <PauseCircle className="w-4 h-4" /> Pause ALL Ads
              </button>

              <button
                onClick={() =>
                  setBulkModal({
                    action: "resume_all_ads",
                    title: "Resume Paused Advertisements",
                    description: "This will restore advertisements that were previously paused by the global bulk pause. Banned or restricted users' ads will remain paused.",
                    dangerLevel: "Medium",
                  })
                }
                className="p-3 bg-slate-950 border border-emerald-900/40 hover:border-emerald-700 text-emerald-300 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all hover:bg-emerald-950/20"
              >
                <PlayCircle className="w-4 h-4" /> Resume Paused Ads
              </button>

              <button
                onClick={() =>
                  setBulkModal({
                    action: "delete_all_ads",
                    title: "Delete ALL Advertisements",
                    description: "This will mark ALL non-deleted advertisements as DELETED. Existing active trades will complete safely. This is a destructive operation.",
                    dangerLevel: "Emergency",
                    requiresPhrase: "DELETE ALL ADS",
                  })
                }
                className="p-3 bg-slate-950 border border-rose-900/40 hover:border-rose-700 text-rose-300 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all hover:bg-rose-950/20"
              >
                <Trash2 className="w-4 h-4" /> Delete ALL Ads
              </button>
            </div>
          </div>

          {/* User Operations */}
          <div className="pt-4 border-t border-slate-800">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3 flex items-center gap-2">
              <Users className="w-4 h-4 text-purple-400" /> Bulk User Status Actions
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <button
                onClick={() =>
                  setBulkModal({
                    action: "ban_all_users",
                    title: "Ban ALL Normal Users",
                    description: "Bans all non-admin users who are not already banned. Snapshots each user's prior state. Pre-existing banned accounts and all admin accounts are strictly preserved untouched. Financial balances and active trade escrows are not modified.",
                    dangerLevel: "Emergency",
                    requiresPhrase: "BAN ALL USERS",
                  })
                }
                className="p-3 bg-slate-950 border border-rose-900/40 hover:border-rose-700 text-rose-300 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all hover:bg-rose-950/20"
              >
                <Ban className="w-4 h-4" /> Ban ALL Users
              </button>

              <button
                onClick={() =>
                  setBulkModal({
                    action: "unban_all_users",
                    title: "Unban Bulk-Banned Users",
                    description: "Restores only users who were banned by the global bulk ban operation back to their exact pre-ban state. Pre-existing manual/fraud/security bans remain permanently banned.",
                    dangerLevel: "High",
                  })
                }
                className="p-3 bg-slate-950 border border-blue-900/40 hover:border-blue-700 text-blue-300 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all hover:bg-blue-950/20"
              >
                <UserCheck className="w-4 h-4" /> Unban All Users
              </button>

              <button
                onClick={() =>
                  setBulkModal({
                    action: "restrict_all_users",
                    title: "Restrict ALL Normal Users",
                    description: "Places non-admin users who are not already restricted or suspended into restricted status. Snapshots prior state. Pre-existing suspensions, bans, and all admin accounts are preserved untouched.",
                    dangerLevel: "High",
                  })
                }
                className="p-3 bg-slate-950 border border-orange-900/40 hover:border-orange-700 text-orange-300 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all hover:bg-orange-950/20"
              >
                <UserX className="w-4 h-4" /> Restrict ALL Users
              </button>

              <button
                onClick={() =>
                  setBulkModal({
                    action: "unrestrict_all_users",
                    title: "Unrestrict Bulk-Restricted Users",
                    description: "Restores only users who were restricted by the global bulk restriction operation back to their exact pre-restriction state. Pre-existing KYC and risk suspensions remain intact.",
                    dangerLevel: "Medium",
                  })
                }
                className="p-3 bg-slate-950 border border-emerald-900/40 hover:border-emerald-700 text-emerald-300 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all hover:bg-emerald-950/20"
              >
                <ShieldCheck className="w-4 h-4" /> Unrestrict All Users
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3. USER BLOCK RELATIONSHIP ADMIN INSPECTOR */}
      <Card className="bg-slate-900 border-slate-800 shadow-md">
        <CardHeader className="border-b border-slate-800/80 pb-4">
          <CardTitle className="text-white text-lg flex items-center justify-between">
            <span className="flex items-center gap-2">
              <ShieldX className="w-5 h-5 text-indigo-400" /> User-to-User Block Relationships
            </span>
            <span className="text-xs font-normal text-slate-400 font-mono">
              Total active blocks: {userBlocks.length}
            </span>
          </CardTitle>
          <CardDescription className="text-slate-400 text-xs">
            Inspect peer-to-peer user blocks stored in <code className="text-indigo-300 font-mono text-xs">public.user_blocks</code>. Administrators can unblock relationships on behalf of users.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loadingBlocks ? (
            <div className="p-8 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" /> Loading user block relationships...
            </div>
          ) : userBlocks.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              No active user-to-user block relationships recorded in the database.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950/80 text-slate-400 uppercase font-semibold border-b border-slate-800">
                  <tr>
                    <th className="px-4 py-3">Blocker (Initiator)</th>
                    <th className="px-4 py-3">Blocked Counterpart</th>
                    <th className="px-4 py-3">Created At</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Admin Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {userBlocks.map((block) => (
                    <tr key={block.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{block.blockerUsername}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{block.blockerEmail}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{block.blockedUsername}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{block.blockedEmail}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {new Date(block.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                          BLOCKED
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setUnblockModal(block)}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-rose-300 hover:text-white rounded border border-slate-700 text-xs font-medium transition-colors"
                        >
                          Unblock Peer
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 4. MARKETPLACE FEES & TRANSACTION THRESHOLDS FORM */}
      <Card className="bg-slate-900 border-slate-800 shadow-md">
        <CardHeader className="border-b border-slate-800/80 pb-4">
          <CardTitle className="text-white text-lg flex items-center gap-2">
            <Percent className="w-5 h-5 text-emerald-400" /> Marketplace Fees & Limits
          </CardTitle>
          <CardDescription className="text-slate-400 text-xs">
            Standard transaction fee percentages and minimum order sizes stored in <code className="text-emerald-300 font-mono text-xs">public.app_settings</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setIsSavingAppSettings(true);
              setFeedback(null);
              const result = await updateAppSettingsAction(new FormData(event.currentTarget));
              setFeedback(result.success
                ? { type: "success", message: "Marketplace fee and minimum trade settings saved." }
                : { type: "error", message: result.error || "Unable to save marketplace fee settings." });
              setIsSavingAppSettings(false);
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300 uppercase flex items-center gap-1.5">
                  <Percent className="w-3.5 h-3.5 text-emerald-400" /> Internal Transfer Fee Percentage (%)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="10"
                  name="platform_fee_percent"
                  defaultValue={appSettings.platform_fee_percent ?? 1.5}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono focus:outline-none focus:border-blue-500 text-sm"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300 uppercase flex items-center gap-1.5">
                  <Percent className="w-3.5 h-3.5 text-emerald-400" /> P2P Escrow Fee Percentage (%)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="10"
                  name="escrow_fee_percent"
                  defaultValue={appSettings.escrow_fee_percent ?? 1.5}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono focus:outline-none focus:border-blue-500 text-sm"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300 uppercase flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5 text-emerald-400" /> Minimum Trade Amount ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  name="min_trade_amount"
                  defaultValue={appSettings.min_trade_amount ?? 10.0}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono focus:outline-none focus:border-blue-500 text-sm"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={isSavingAppSettings}
                className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shadow-md transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {isSavingAppSettings ? "Saving..." : "Save Fee Thresholds"}
              </button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* 5. WITHDRAWAL SECURITY & GOVERNANCE THRESHOLDS */}
      <Card className="bg-slate-900 border-slate-800 shadow-md">
        <CardHeader className="border-b border-slate-800/80 pb-4">
          <CardTitle className="text-white text-lg flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-400" /> Withdrawal Governance & Risk Thresholds
          </CardTitle>
          <CardDescription className="text-slate-400 text-xs">
            Server-enforced limits stored in <code className="text-amber-300 font-mono text-xs">public.platform_settings</code>. Requires admin 2FA verification.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setIsSavingWithdrawalGovernance(true);
              setFeedback(null);
              const result = await updateWithdrawalGovernanceAction(new FormData(event.currentTarget));
              setFeedback(result.success
                ? { type: "success", message: "Withdrawal governance and gas fee multiplier saved." }
                : { type: "error", message: result.error || "Unable to save withdrawal governance settings." });
              setIsSavingWithdrawalGovernance(false);
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300 uppercase flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5 text-amber-400" /> Single Withdrawal Maximum ($ USD)
                </label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  name="max_single_withdrawal_usd"
                  defaultValue={withdrawalGovernance.max_single_withdrawal_usd}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono focus:outline-none focus:border-amber-500 text-sm"
                />
                <p className="text-[11px] text-slate-500">Hard ceiling per transaction. Requests exceeding this trigger security freeze.</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300 uppercase flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5 text-amber-400" /> Admin Approval Threshold ($ USD)
                </label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  name="withdrawal_approval_threshold_usd"
                  defaultValue={withdrawalGovernance.withdrawal_approval_threshold_usd}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono focus:outline-none focus:border-amber-500 text-sm"
                />
                <p className="text-[11px] text-slate-500">Withdrawals at or above this threshold transition to PENDING_APPROVAL.</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300 uppercase flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5 text-amber-400" /> Daily Cumulative Limit ($ USD)
                </label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  name="daily_withdrawal_limit_usd"
                  defaultValue={withdrawalGovernance.daily_withdrawal_limit_usd}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono focus:outline-none focus:border-amber-500 text-sm"
                />
                <p className="text-[11px] text-slate-500">Rolling 24-hour total withdrawal ceiling per user account.</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300 uppercase flex items-center gap-1.5">
                  <Percent className="w-3.5 h-3.5 text-amber-400" /> Withdrawal Network Gas Multiplier (×)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="1"
                  max="10"
                  name="withdrawal_fee_multiplier"
                  defaultValue={withdrawalGovernance.withdrawal_fee_multiplier}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono focus:outline-none focus:border-amber-500 text-sm"
                />
                <p className="text-[11px] text-slate-500">User withdrawal fee = estimated network gas × this multiplier. Default: 2×.</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300 uppercase flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-amber-400" /> Password Change Hold (Hours)
                </label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  max="168"
                  name="password_change_withdrawal_hold_hours"
                  defaultValue={withdrawalGovernance.password_change_withdrawal_hold_hours}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono focus:outline-none focus:border-amber-500 text-sm"
                />
                <p className="text-[11px] text-slate-500">Duration withdrawals are held after user changes or resets password (default: 24h).</p>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={isSavingWithdrawalGovernance}
                className="flex items-center gap-2 px-5 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg shadow-md transition-colors cursor-pointer disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {isSavingWithdrawalGovernance ? "Saving..." : "Save Withdrawal Governance"}
              </button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* CONFIRMATION MODAL: TOGGLE PLATFORM CONTROL */}
      {pendingToggle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 space-y-5">
            <div className="flex items-start gap-3">
              <div
                className={`p-3 rounded-xl ${
                  pendingToggle.nextValue ? "bg-rose-500/20 text-rose-400" : "bg-emerald-500/20 text-emerald-400"
                }`}
              >
                {pendingToggle.nextValue ? <Lock className="w-6 h-6" /> : <Unlock className="w-6 h-6" />}
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-white">
                  Confirm {pendingToggle.nextValue ? "Enabling" : "Disabling"}: {pendingToggle.config.title}
                </h3>
                <p className="text-xs text-slate-400">
                  Danger Level:{" "}
                  <span className="font-bold text-rose-400">{pendingToggle.config.dangerLevel}</span>
                </p>
              </div>
            </div>

            <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300 leading-relaxed">
              {pendingToggle.nextValue
                ? pendingToggle.config.enableConfirmation
                : pendingToggle.config.disableConfirmation}
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300">
                Audit Reason / Note (Optional):
              </label>
              <input
                type="text"
                value={toggleReason}
                onChange={(e) => setToggleReason(e.target.value)}
                placeholder="e.g. Scheduled database maintenance / Emergency risk mitigation"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setPendingToggle(null)}
                disabled={isSubmittingToggle}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmToggle}
                disabled={isSubmittingToggle}
                className={`px-5 py-2 text-white rounded-lg text-xs font-semibold shadow-lg transition-all flex items-center gap-2 ${
                  pendingToggle.nextValue
                    ? "bg-rose-600 hover:bg-rose-500"
                    : "bg-emerald-600 hover:bg-emerald-500"
                }`}
              >
                {isSubmittingToggle ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Applying...
                  </>
                ) : (
                  <>Confirm & Apply</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRMATION MODAL: BULK ACTION */}
      {bulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-slate-900 border border-rose-800/80 rounded-2xl shadow-2xl p-6 space-y-5">
            <div className="flex items-start gap-3">
              <div className="p-3 rounded-xl bg-rose-500/20 text-rose-400">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-white">{bulkModal.title}</h3>
                <p className="text-xs text-rose-300">
                  Danger Level: <span className="font-bold">{bulkModal.dangerLevel}</span>
                </p>
              </div>
            </div>

            <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300 leading-relaxed">
              {bulkModal.description}
            </div>

            {bulkModal.requiresPhrase && (
              <div className="space-y-2 p-3 bg-rose-950/40 rounded-xl border border-rose-800/60">
                <label className="text-xs font-semibold text-rose-300">
                  Type <span className="font-mono font-bold text-white bg-slate-950 px-1.5 py-0.5 rounded border border-rose-700">{bulkModal.requiresPhrase}</span> to confirm:
                </label>
                <input
                  type="text"
                  value={typedPhrase}
                  onChange={(e) => setTypedPhrase(e.target.value)}
                  placeholder={bulkModal.requiresPhrase}
                  className="w-full px-3 py-2 bg-slate-950 border border-rose-800 rounded-lg text-white font-mono text-xs focus:outline-none focus:border-rose-500"
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setBulkModal(null);
                  setTypedPhrase("");
                }}
                disabled={isExecutingBulk}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeBulkAction}
                disabled={
                  isExecutingBulk ||
                  Boolean(bulkModal.requiresPhrase && typedPhrase.trim() !== bulkModal.requiresPhrase)
                }
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-lg transition-all flex items-center gap-2"
              >
                {isExecutingBulk ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Executing...
                  </>
                ) : (
                  <>Execute Operation</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRMATION MODAL: ADMIN UNBLOCK */}
      {unblockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-indigo-400" /> Confirm Administrative Unblock
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to remove the block between{" "}
              <strong className="text-white">{unblockModal.blockerUsername}</strong> and{" "}
              <strong className="text-white">{unblockModal.blockedUsername}</strong>? This action will be recorded in the admin audit log.
            </p>
            <div className="flex items-center justify-end gap-3 pt-3">
              <button
                onClick={() => setUnblockModal(null)}
                disabled={isUnblocking}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={executeAdminUnblock}
                disabled={isUnblocking}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center gap-2"
              >
                {isUnblocking ? "Unblocking..." : "Confirm Unblock"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
