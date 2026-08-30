
import type { Trade, Deposit, Withdrawal } from './types';

// Union of all possible status types
export type AllStatus = Trade['status'] | Deposit['status'] | Withdrawal['status'];

// A map of each status to its corresponding Tailwind CSS classes
export const statusColors: Record<AllStatus, string> = {
  // Trade statuses
  active: "border-blue-500/50 text-blue-600 bg-blue-50 dark:bg-blue-950/60 dark:border-blue-800/50 dark:text-blue-200",
  paid: "border-yellow-500/50 text-yellow-600 bg-yellow-50 dark:bg-yellow-950/60 dark:border-yellow-800/50 dark:text-yellow-200",
  released: "border-green-500/50 text-green-600 bg-green-50 dark:bg-green-950/60 dark:border-green-800/50 dark:text-green-200",
  disputed: "border-red-500/50 text-red-600 bg-red-50 dark:bg-red-950/60 dark:border-red-800/50 dark:text-red-200",
  cancelled: "border-gray-500/50 text-gray-600 bg-gray-50 dark:bg-gray-800/60 dark:border-gray-700/50 dark:text-gray-200",
  
  // Deposit statuses (some overlap with trade)
  pending: "border-gray-500/50 text-gray-600 bg-gray-50 dark:bg-gray-800/60 dark:border-gray-700/50 dark:text-gray-200",
  awaiting_confirmation: "border-yellow-500/50 text-yellow-600 bg-yellow-50 dark:bg-yellow-950/60 dark:border-yellow-800/50 dark:text-yellow-200",
  approved: "border-green-500/50 text-green-600 bg-green-50 dark:bg-green-950/60 dark:border-green-800/50 dark:text-green-200",
  declined: "border-red-500/50 text-red-600 bg-red-50 dark:bg-red-950/60 dark:border-red-800/50 dark:text-red-200",
  expired: "border-orange-500/50 text-orange-600 bg-orange-50 dark:bg-orange-950/60 dark:border-orange-800/50 dark:text-orange-200",
};
