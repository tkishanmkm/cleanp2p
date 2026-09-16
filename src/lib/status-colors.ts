
import type { Trade, Deposit, Withdrawal } from './types';

// Union of all possible status types
export type AllStatus = Trade['status'] | Deposit['status'] | Withdrawal['status'];

// A map of each status to its corresponding Tailwind CSS classes
export const statusColors: Record<string, string> = {
  // Trade statuses as per user specification:
  // Active (green)
  active: "border-emerald-500/50 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 dark:border-emerald-800/50 dark:text-emerald-300",
  // Pending (yellow)
  pending: "border-amber-400/50 text-amber-600 bg-amber-50 dark:bg-amber-950/60 dark:border-amber-800/50 dark:text-amber-300",
  // Mark Paid (orange)
  paid: "border-orange-500/50 text-orange-600 bg-orange-50 dark:bg-orange-950/60 dark:border-orange-800/50 dark:text-orange-300",
  mark_paid: "border-orange-500/50 text-orange-600 bg-orange-50 dark:bg-orange-950/60 dark:border-orange-800/50 dark:text-orange-300",
  // Disputed (red)
  disputed: "border-rose-500/50 text-rose-600 bg-rose-50 dark:bg-rose-950/60 dark:border-rose-800/50 dark:text-rose-300",
  dispute: "border-rose-500/50 text-rose-600 bg-rose-50 dark:bg-rose-950/60 dark:border-rose-800/50 dark:text-rose-300",
  // Cancelled (light red)
  cancelled: "border-rose-300/50 text-rose-500 bg-rose-50/60 dark:bg-rose-950/30 dark:border-rose-800/40 dark:text-rose-300",
  canceled: "border-rose-300/50 text-rose-500 bg-rose-50/60 dark:bg-rose-950/30 dark:border-rose-800/40 dark:text-rose-300",
  // Expired (grey)
  expired: "border-slate-400/50 text-slate-500 bg-slate-100 dark:bg-slate-800/60 dark:border-slate-700/50 dark:text-slate-400",
  // Completed (light green)
  completed: "border-lime-500/50 text-lime-700 bg-lime-50 dark:bg-lime-950/60 dark:border-lime-800/50 dark:text-lime-300",
  released: "border-lime-500/50 text-lime-700 bg-lime-50 dark:bg-lime-950/60 dark:border-lime-800/50 dark:text-lime-300",
  
  // Deposit & Withdrawal statuses
  confirmed: "border-lime-500/50 text-lime-700 bg-lime-50 dark:bg-lime-950/60 dark:border-lime-800/50 dark:text-lime-300",
  credited: "border-lime-500/50 text-lime-700 bg-lime-50 dark:bg-lime-950/60 dark:border-lime-800/50 dark:text-lime-300",
  approved: "border-lime-500/50 text-lime-700 bg-lime-50 dark:bg-lime-950/60 dark:border-lime-800/50 dark:text-lime-300",

  // Grey for Processing / Detected
  processing: "border-slate-400/50 text-slate-600 bg-slate-100/80 dark:bg-slate-800/70 dark:border-slate-700/60 dark:text-slate-300",
  detected: "border-slate-400/50 text-slate-600 bg-slate-100/80 dark:bg-slate-800/70 dark:border-slate-700/60 dark:text-slate-300",
  awaiting_confirmation: "border-amber-400/50 text-amber-600 bg-amber-50 dark:bg-amber-950/60 dark:border-amber-800/50 dark:text-amber-300",
  
  // Rejected / Declined
  rejected: "border-rose-500/50 text-rose-600 bg-rose-50 dark:bg-rose-950/60 dark:border-rose-800/50 dark:text-rose-200",
  declined: "border-rose-500/50 text-rose-600 bg-rose-50 dark:bg-rose-950/60 dark:border-rose-800/50 dark:text-rose-200",
};
