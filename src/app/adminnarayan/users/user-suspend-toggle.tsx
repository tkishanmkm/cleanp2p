"use client";

import { useTransition } from "react";
import { toggleUserSuspensionAction } from "./actions";
import { Ban, CheckCircle2 } from "lucide-react";

interface UserSuspendToggleProps {
  userId: string;
  isSuspended: boolean;
}

export function UserSuspendToggle({ userId, isSuspended }: UserSuspendToggleProps) {
  const [isPending, startTransition] = useTransition();

  const handleToggle = () => {
    const actionText = isSuspended ? "un-suspend" : "suspend";
    
    if (confirm(`Are you sure you want to ${actionText} this user account?`)) {
      startTransition(async () => {
        const res = await toggleUserSuspensionAction(userId, isSuspended);
        if (res?.error) {
          alert(`Error toggling suspension: ${res.error}`);
        }
      });
    }
  };

  return (
    <button
      onClick={handleToggle}
      disabled={isPending}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
        isSuspended
          ? "bg-emerald-950/40 border-emerald-800 text-emerald-300 hover:bg-emerald-900/60"
          : "bg-red-950/40 border-red-800 text-red-300 hover:bg-red-900/60"
      }`}
    >
      {isSuspended ? (
        <>
          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          {isPending ? "Reactivating..." : "Reactivate"}
        </>
      ) : (
        <>
          <Ban className="w-3 h-3 text-red-400" />
          {isPending ? "Suspending..." : "Suspend"}
        </>
      )}
    </button>
  );
}
