"use client";

import { useTransition } from "react";
import { updateUserRoleAction } from "./actions";
import { Shield, User } from "lucide-react";

interface UserRoleToggleProps {
  userId: string;
  currentRole: string;
}

export function UserRoleToggle({ userId, currentRole }: UserRoleToggleProps) {
  const [isPending, startTransition] = useTransition();

  const handleToggle = () => {
    const nextRole = currentRole === "admin" ? "user" : "admin";
    
    if (confirm(`Are you sure you want to change this user's role to '${nextRole}'?`)) {
      startTransition(async () => {
        const res = await updateUserRoleAction(userId, nextRole);
        if (res?.error) {
          alert(`Error updating role: ${res.error}`);
        }
      });
    }
  };

  return (
    <button
      onClick={handleToggle}
      disabled={isPending}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
        currentRole === "admin"
          ? "bg-purple-950/40 border-purple-800 text-purple-300 hover:bg-purple-900/60"
          : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
      }`}
    >
      {currentRole === "admin" ? (
        <>
          <Shield className="w-3 h-3 text-purple-400" />
          {isPending ? "Demoting..." : "Make User"}
        </>
      ) : (
        <>
          <User className="w-3 h-3 text-slate-400" />
          {isPending ? "Promoting..." : "Make Admin"}
        </>
      )}
    </button>
  );
}
