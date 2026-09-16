
import type { Trade, Deposit, Withdrawal } from './types';

// Union of all possible status types
export type AllStatus = Trade['status'] | Deposit['status'] | Withdrawal['status'];

// A map of each status to its corresponding Tailwind CSS classes
export const statusColors: Record<string, string> = {
  // Trade statuses
  active: "border-blue-500/50 text-blue-600 bg-blue-50 dark:bg-blue-950/60 dark:border-blue-800/50 dark:text-blue-200",
  paid: "border-yellow-500/50 text-yellow-600 bg-yellow-50 dark:bg-yellow-950/60 dark:border-yellow-800/50 dark:text-yellow-200",
  released: "border-emerald-500/50 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 dark:border-emerald-800/50 dark:text-emerald-300",
  disputed: "border-red-500/50 text-red-600 bg-red-50 dark:bg-red-950/60 dark:border-red-800/50 dark:text-red-200",
  cancelled: "border-slate-500/50 text-slate-600 bg-slate-50 dark:bg-slate-800/60 dark:border-slate-700/50 dark:text-slate-300",
  
  // Deposit & Withdrawal statuses - Green for Confirmed / Credited / Completed / Approved
  confirmed: "border-emerald-500/50 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 dark:border-emerald-800/50 dark:text-emerald-300",
  credited: "border-emerald-500/50 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 dark:border-emerald-800/50 dark:text-emerald-300",
  completed: "border-emerald-500/50 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 dark:border-emerald-800/50 dark:text-emerald-300",
  approved: "border-emerald-500/50 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 dark:border-emerald-800/50 dark:text-emerald-300",

  // Grey for Processing / Pending / Detected
  pending: "border-slate-400/50 text-slate-600 bg-slate-100/80 dark:bg-slate-800/70 dark:border-slate-700/60 dark:text-slate-300",
  processing: "border-slate-400/50 text-slate-600 bg-slate-100/80 dark:bg-slate-800/70 dark:border-slate-700/60 dark:text-slate-300",
  detected: "border-slate-400/50 text-slate-600 bg-slate-100/80 dark:bg-slate-800/70 dark:border-slate-700/60 dark:text-slate-300",
  awaiting_confirmation: "border-amber-500/50 text-amber-600 bg-amber-50 dark:bg-amber-950/60 dark:border-amber-800/50 dark:text-amber-200",
  
  // Rejected / Declined / Expired
  rejected: "border-red-500/50 text-red-600 bg-red-50 dark:bg-red-950/60 dark:border-red-800/50 dark:text-red-200",
  declined: "border-red-500/50 text-red-600 bg-red-50 dark:bg-red-950/60 dark:border-red-800/50 dark:text-red-200",
  expired: "border-orange-500/50 text-orange-600 bg-orange-50 dark:bg-orange-950/60 dark:border-orange-800/50 dark:text-orange-200",
};
