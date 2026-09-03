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
      cookieOptions: {
        sameSite: "none",
        secure: true,
        path: "/",
      },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, {
              ...options,
              sameSite: "none",
              secure: true,
            })
          );
        },
      },
    }
  );

  const pathname = request.nextUrl.pathname;
  const isAdminRoute =
    pathname.startsWith("/adminnarayan") &&
    !pathname.startsWith("/adminnarayan/login");

  if (isAdminRoute) {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const currentUser =
        user || (await supabase.auth.getSession()).data.session?.user;

      // Only if the server affirmatively detected a logged-in user who is NOT an admin, redirect
      if (currentUser) {
        let isAdmin = false;
        try {
          const { data: verificationResult, error: rpcError } = await supabase.rpc(
            "verify_admin_login",
            { user_uuid: currentUser.id }
          );
          if (!rpcError && verificationResult?.[0]?.is_valid === true) {
            isAdmin = true;
          }
        } catch {}

        if (!isAdmin) {
          try {
            const { data: checkAdmin, error: checkError } = await supabase.rpc(
              "check_is_admin",
              { user_uuid: currentUser.id }
            );
            if (
              !checkError &&
              (checkAdmin === true || checkAdmin?.[0]?.is_valid === true)
            ) {
              isAdmin = true;
            }
          } catch {}
        }

        if (!isAdmin) {
          return NextResponse.redirect(
            new URL("/adminnarayan/login?error=unauthorized", request.url)
          );
        }
      }
    } catch {}
  }

  return response;
}

export const config = {
  matcher: ["/adminnarayan/:path*"],
};
