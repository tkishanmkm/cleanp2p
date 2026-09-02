"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertCircle, ShieldAlert, Loader2 } from "lucide-react";

function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const redirectTo = searchParams.get("redirectTo") || "/adminnarayan/dashboard";

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);
    setStatusMessage("Authenticating credentials...");

    try {
      const formData = new FormData(e.currentTarget);
      const email = formData.get("email") as string;
      const password = formData.get("password") as string;

      if (!email || !password) {
        throw new Error("Please enter both email and password.");
      }

      const supabase = createClient();
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError || !data.user) {
        throw new Error(signInError?.message || "Authentication failed.");
      }

      setStatusMessage("Verifying admin privileges...");

      // Call RPC with a 5-second timeout wrapper to prevent indefinite hanging
      const rpcPromise = supabase.rpc("verify_admin_login", { user_uuid: data.user.id });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Verification timeout")), 5000)
      );

      const { data: verificationResult, error: rpcError } = await Promise.race([
        rpcPromise,
        timeoutPromise,
      ]) as any;

      if (rpcError) {
        throw new Error(`Verification error: ${rpcError.message}`);
      }

      const check = verificationResult?.[0];
      if (!check || !check.is_valid) {
        await supabase.auth.signOut();
        throw new Error(`Access Denied: ${check?.error_msg || "Insufficient privileges."}`);
      }

      setStatusMessage("Success! Redirecting to dashboard...");
      router.push(redirectTo);
      router.refresh();
    } catch (err: any) {
      await supabase.auth.signOut().catch(() => {});
      setLoading(false);
      setStatusMessage("");
      const message = err.message || "An unexpected error occurred.";
      setErrorMsg(message);
      if (typeof window !== "undefined" && window.alert) {
        try {
          window.alert(message);
        } catch (_) {}
      }
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-900 text-slate-100">
      <Card className="w-full max-w-md bg-slate-800 border-slate-700">
        <CardHeader className="space-y-2">
          <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center">
            <ShieldAlert className="w-6 h-6 text-white" />
          </div>
          <div>
            <CardTitle className="text-2xl font-bold text-white">Admin Portal Login</CardTitle>
            <CardDescription className="text-slate-400">
              Enter your credentials to access the marketplace dashboard.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
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

            <Button id="admin-login-submit-btn" type="submit" className="w-full bg-blue-600 hover:bg-blue-500" disabled={loading}>
              {loading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {statusMessage}
                </span>
              ) : (
                "Sign In to Dashboard"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-900 text-slate-100">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    }>
      <AdminLoginForm />
    </Suspense>
  );
}
