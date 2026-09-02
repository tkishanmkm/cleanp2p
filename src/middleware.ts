import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Read and validate auth token from request cookies
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  const isLoginPage = request.nextUrl.pathname === "/adminnarayan/login";
  const isAdminRoute = request.nextUrl.pathname.startsWith("/adminnarayan");

  // Protect admin routes
  if (isAdminRoute && !isLoginPage && !user) {
    console.log(`[MIDDLEWARE REDIRECT] No active session on ${request.nextUrl.pathname}. Redirecting to login.`);
    return NextResponse.redirect(new URL("/adminnarayan/login", request.url));
  }

  // Prevent logged-in admin from returning to login page
  if (isLoginPage && user) {
    console.log(`[MIDDLEWARE REDIRECT] Active user ${user.email} accessed login page. Redirecting to dashboard.`);
    return NextResponse.redirect(new URL("/adminnarayan/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
