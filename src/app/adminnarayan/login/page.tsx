"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertCircle, ShieldAlert, Loader2 } from "lucide-react";

function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchError = searchParams.get("error");
  const [errorMsg, setErrorMsg] = useState<string | null>(
    searchError === "unauthorized"
      ? "Access Denied: You do not have administrator permissions or your session expired."
      : null
  );
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [existingAdmin, setExistingAdmin] = useState<{ email: string; id: string } | null>(null);
  const [checkingExisting, setCheckingExisting] = useState(true);

  const redirectTo = searchParams.get("redirectTo") || "/adminnarayan/dashboard";

  // Check if already authenticated with valid admin role
  useEffect(() => {
    let isMounted = true;
    async function checkExistingAdmin() {
      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        
        if (session?.user && isMounted) {
          const user = session.user;
          const { data: verificationResult } = await supabase.rpc(
            "verify_admin_login",
            { user_uuid: user.id }
          );
          if (verificationResult?.[0]?.is_valid && isMounted) {
            setExistingAdmin({ email: user.email || "", id: user.id });
          }
        }
      } catch {} finally {
        if (isMounted) setCheckingExisting(false);
      }
    }
    checkExistingAdmin();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);
    setStatusMessage("Authenticating credentials...");

    const supabase = createClient();

    try {
      const formData = new FormData(e.currentTarget);
      const email = formData.get("email") as string;
      const password = formData.get("password") as string;

      if (!email || !password) {
        throw new Error("Please enter both email and password.");
      }

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError || !data.user) {
        throw new Error(signInError?.message || "Authentication failed.");
      }

      setStatusMessage("Verifying admin privileges...");

      // Call RPC with a 5-second timeout wrapper
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

      setStatusMessage("Access confirmed! Navigating to dashboard...");
      setExistingAdmin({ email: data.user.email || email, id: data.user.id });

      // Navigate smoothly to dashboard
      router.push(redirectTo);
      router.refresh();

      // Fallback reload if router push is delayed
      setTimeout(() => {
        if (window.location.pathname === "/adminnarayan/login") {
          window.location.assign(redirectTo);
        }
      }, 800);
    } catch (err: any) {
      await supabase.auth.signOut().catch(() => {});
      setLoading(false);
      setStatusMessage("");
      const message = err.message || "An unexpected error occurred.";
      setErrorMsg(message);
    }
  };

  const handleSwitchAccount = async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {}
    setExistingAdmin(null);
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-900 text-slate-100">
      <Card className="w-full max-w-md bg-slate-800 border-slate-700">
        <CardHeader className="space-y-2">
          <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center">
            <ShieldAlert className="w-6 h-6 text-white" />
          </div>
          <div>
            <CardTitle className="text-2xl font-bold text-white">Admin Portal</CardTitle>
            <CardDescription className="text-slate-400">
              Enter your credentials to access the marketplace dashboard.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorMsg && (
            <div className="p-3 bg-red-950/80 border border-red-500/50 text-red-200 rounded-lg text-sm flex items-start gap-2 break-words">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-red-300">Login Failed</p>
                <p>{errorMsg}</p>
              </div>
            </div>
          )}

          {existingAdmin && !loading && (
            <div className="p-4 bg-blue-950/60 border border-blue-600/40 rounded-lg space-y-3">
              <div className="flex items-center gap-2 text-sm text-blue-200">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Signed in as <strong>{existingAdmin.email}</strong> (Admin)</span>
              </div>
              <Button
                id="continue-to-dashboard-btn"
                onClick={() => {
                  router.push(redirectTo);
                  router.refresh();
                  setTimeout(() => {
                    if (window.location.pathname === "/adminnarayan/login") {
                      window.location.assign(redirectTo);
                    }
                  }, 400);
                }}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium"
              >
                Continue to Admin Dashboard
              </Button>
              <Button
                id="switch-account-btn"
                variant="ghost"
                size="sm"
                onClick={handleSwitchAccount}
                className="w-full text-xs text-slate-400 hover:text-white"
              >
                Sign In as Different User
              </Button>
            </div>
          )}

          {(!existingAdmin || searchError) && (
            <form onSubmit={handleLogin} className="space-y-4">
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

              <Button id="admin-login-submit-btn" type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white" disabled={loading}>
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
          )}
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
