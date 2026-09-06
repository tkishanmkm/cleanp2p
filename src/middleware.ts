import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  let response = NextResponse.next({ request: { headers: request.headers } });

  // 1. Initialize Supabase Session with Cookie Management
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

  const { data: { user } } = await supabase.auth.getUser();

  // 2. Service Authorization for Background Workers and Cron Jobs
  if (
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/api/internal/") ||
    pathname.startsWith("/api/workers/") ||
    pathname.startsWith("/api/jobs/")
  ) {
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET || process.env.DEPOSIT_WORKER_SECRET || process.env.CRON_SECRET_KEY;
    const workerSecret = process.env.WITHDRAWAL_WORKER_SECRET || process.env.DEPOSIT_WORKER_SECRET;
    
    const isWorkerAuthorized = Boolean(
      (cronSecret && (authHeader === `Bearer ${cronSecret}` || request.headers.get("x-worker-secret") === cronSecret || request.headers.get("x-cron-secret") === cronSecret)) ||
      (workerSecret && (authHeader === `Bearer ${workerSecret}` || request.headers.get("x-worker-secret") === workerSecret))
    );

    if (!isWorkerAuthorized) {
      return NextResponse.json({ error: "Forbidden: Internal worker authorization required" }, { status: 403 });
    }
    return response;
  }

  // 3. User Financial & Authenticated Endpoints Guard
  if (
    pathname.startsWith("/api/withdraw") || 
    pathname.startsWith("/api/withdrawals/") || 
    pathname.startsWith("/api/p2p/orders/") ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/wallets")
  ) {
    if (!user) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthorized: Active session required" }, { status: 401 });
      }
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }

  // 4. Strict Admin Endpoint Authorization
  if (pathname.startsWith("/api/admin/") || pathname.startsWith("/adminnarayan")) {
    if (!user) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthorized: Admin authentication required" }, { status: 401 });
      }
      return NextResponse.redirect(new URL("/adminnarayan/login", request.url));
    }

    // Cryptographic role verification against Supabase database function
    const { data: isAdmin } = await supabase.rpc("check_is_admin", { p_user_id: user.id });

    if (!isAdmin) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Forbidden: Administrator privileges required" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/unauthorized", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/adminnarayan/:path*",
    "/api/admin/:path*",
    "/api/p2p/orders/:path*",
    "/api/p2p/trades/:path*",
    "/api/withdraw",
    "/api/withdrawals/:path*",
    "/api/internal/:path*",
    "/api/cron/:path*",
    "/api/workers/:path*",
    "/dashboard/:path*",
    "/wallets/:path*",
  ],
};
