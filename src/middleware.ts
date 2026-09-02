import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const pathname = request.nextUrl.pathname;
  const isAdminRoute = pathname.startsWith("/adminnarayan");

  if (isAdminRoute) {
    // Allow public access to admin login page
    if (pathname === "/adminnarayan/login") {
      return response;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = "/adminnarayan/login";
      url.searchParams.set("redirectTo", pathname);
      return NextResponse.redirect(url);
    }

    // Robust fetch using primary id matching
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("role, is_suspended")
      .or(`id.eq.${user.id},user_id.eq.${user.id}`)
      .limit(1)
      .maybeSingle();

    // Debug check or fail safe: if role is admin (case-insensitive check) and not suspended, let them through
    const userRole = profile?.role ? String(profile.role).trim().toLowerCase() : "";
    const isSuspended = Boolean(profile?.is_suspended);

    if (error || !profile || userRole !== "admin" || isSuspended) {
      // Redirect home if check fails
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: ["/adminnarayan/:path*"],
};
