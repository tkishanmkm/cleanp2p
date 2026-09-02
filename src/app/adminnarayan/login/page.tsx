"use client";

import { useState, useTransition } from "react";
import { loginAdminAction } from "./actions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

export default function AdminLoginPage() {
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMsg(null);

    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      try {
        const result = await loginAdminAction(formData);
        if (result?.error) {
          setErrorMsg(result.error);
        }
      } catch (err: any) {
        // Catch next/navigation redirect throw (normal Next.js behavior)
        if (err?.message?.includes("NEXT_REDIRECT")) {
          return;
        }
        setErrorMsg(err?.message || "An unexpected error occurred during submission.");
      }
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-900 text-slate-100">
      <Card className="w-full max-w-md bg-slate-800 border-slate-700">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-white">Admin Portal Login</CardTitle>
          <CardDescription className="text-slate-400">
            Enter your credentials to access the marketplace dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {errorMsg && (
              <div className="p-3 bg-red-950/80 border border-red-500/50 text-red-200 rounded-lg text-sm flex items-start gap-2 break-words">
                <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-red-300">Login Failed</p>
                  <p>{errorMsg}</p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Email</label>
              <Input
                name="email"
                type="email"
                placeholder="admin@example.com"
                defaultValue="tkishanmkm@gmail.com"
                required
                className="bg-slate-900 border-slate-700 text-white"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Password</label>
              <Input
                name="password"
                type="password"
                placeholder="••••••••"
                required
                className="bg-slate-900 border-slate-700 text-white"
              />
            </div>

            <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-500" disabled={isPending}>
              {isPending ? "Authenticating & Verifying Role..." : "Sign In to Admin Panel"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
