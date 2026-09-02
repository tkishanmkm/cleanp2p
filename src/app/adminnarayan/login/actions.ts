"use server";

import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase/admin";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function loginAdminAction(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Please provide both email and password." };
  }

  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Handled via middleware
          }
        },
      },
    }
  );

  // 1. Authenticate user
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (authError) {
    return { error: `[Auth Error]: ${authError.message}` };
  }

  if (!authData.user) {
    return { error: "[Auth Error]: Account authenticated, but user record was null." };
  }

  // 2. Query admin profile bypassing RLS with service role client
  const adminSupabase = createAdminClient();
  const { data: profile, error: profileError } = await adminSupabase
    .from("profiles")
    .select("role, is_suspended")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError || !profile || String(profile.role).trim().toLowerCase() !== "admin" || profile.is_suspended) {
    await supabase.auth.signOut();
    return { 
      error: `Access denied: Insufficient privileges or account suspended.` 
    };
  }

  // 3. Successful login -> issue HTTP-only cookies and redirect
  redirect("/adminnarayan/dashboard");
}
