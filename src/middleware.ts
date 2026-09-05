import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// ============================================================================
// In-Memory Sliding Window Rate Limiter
// ============================================================================
interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitBucket>();

// Periodically clean up expired rate limit entries to prevent memory bloat
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of rateLimitStore.entries()) {
      if (now > bucket.resetAt) {
        rateLimitStore.delete(key);
      }
    }
  }, 60000); // Clean every minute
}

function checkRateLimit(
  identifier: string,
  limit: number,
  windowSeconds: number
): { allowed: boolean; remaining: number; retryAfter: number } {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const bucket = rateLimitStore.get(identifier);

  if (!bucket || now > bucket.resetAt) {
    rateLimitStore.set(identifier, {
      count: 1,
      resetAt: now + windowMs,
    });
    return { allowed: true, remaining: limit - 1, retryAfter: 0 };
  }

  if (bucket.count >= limit) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }

  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count, retryAfter: 0 };
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const clientIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "127.0.0.1";

  // --------------------------------------------------------------------------
  // 1. CRON & BACKGROUND JOB HARDENING (/api/jobs/*)
  // --------------------------------------------------------------------------
  if (pathname.startsWith("/api/jobs/")) {
    // Rate limit cron invocations: 30 requests per minute per IP
    const { allowed, retryAfter } = checkRateLimit(`cron:${clientIp}`, 30, 60);
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many requests to background job endpoint" },
        { status: 429, headers: { "Retry-After": retryAfter.toString() } }
      );
    }

    const cronSecret =
      process.env.CRON_SECRET ||
      process.env.CRON_SECRET_KEY ||
      process.env.WORKER_SECRET;

    if (cronSecret && cronSecret.trim().length > 0) {
      const authHeader = request.headers.get("authorization");
      const xCronHeader = request.headers.get("x-cron-secret");
      const bearerToken = authHeader?.startsWith("Bearer ")
        ? authHeader.substring(7).trim()
        : null;

      if (bearerToken !== cronSecret && xCronHeader !== cronSecret) {
        return NextResponse.json(
          { error: "Unauthorized: Invalid or missing CRON_SECRET" },
          { status: 401 }
        );
      }
    }
  }

  // --------------------------------------------------------------------------
  // 2. SUPABASE SSR CLIENT & JWT VALIDATION
  // --------------------------------------------------------------------------
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

  // Authenticate user session
  let currentUser: any = null;
  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (!userError && user) {
      currentUser = user;
    } else {
      currentUser = (await supabase.auth.getSession()).data.session?.user || null;
    }
  } catch (_) {}

  // --------------------------------------------------------------------------
  // 3. P2P ORDER CREATION PROTECTION & RATE LIMITING (/api/p2p/orders/create)
  // --------------------------------------------------------------------------
  if (pathname === "/api/p2p/orders/create") {
    if (!currentUser) {
      return NextResponse.json(
        { error: "Unauthorized: Valid authenticated session required" },
        { status: 401 }
      );
    }

    // Rate limit order creation: 10 requests per minute per user/IP
    const rateLimitKey = `p2p_order:${currentUser.id || clientIp}`;
    const { allowed, retryAfter } = checkRateLimit(rateLimitKey, 10, 60);

    if (!allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded: Please wait before placing another order" },
        { status: 429, headers: { "Retry-After": retryAfter.toString() } }
      );
    }
  }

  // --------------------------------------------------------------------------
  // 4. ADMIN API ENDPOINTS PROTECTION & RATE LIMITING (/api/admin/*)
  // --------------------------------------------------------------------------
  if (pathname.startsWith("/api/admin/")) {
    const rateLimitKey = `admin_api:${currentUser?.id || clientIp}`;
    const { allowed, retryAfter } = checkRateLimit(rateLimitKey, 60, 60);

    if (!allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded for administrative API" },
        { status: 429, headers: { "Retry-After": retryAfter.toString() } }
      );
    }

    // Allow /api/admin/reconcile with valid CRON_SECRET
    const cronSecret =
      process.env.CRON_SECRET || process.env.CRON_SECRET_KEY;
    const authHeader = request.headers.get("authorization");
    const xCronHeader = request.headers.get("x-cron-secret");
    const bearer = authHeader?.startsWith("Bearer ")
      ? authHeader.substring(7).trim()
      : null;
    const isCronAuthorized =
      cronSecret && (bearer === cronSecret || xCronHeader === cronSecret);

    if (!currentUser && !isCronAuthorized) {
      return NextResponse.json(
        { error: "Unauthorized: Admin session required" },
        { status: 401 }
      );
    }
  }

  // --------------------------------------------------------------------------
  // 5. ADMIN UI ROUTE PROTECTION (/adminnarayan/*)
  // --------------------------------------------------------------------------
  const isAdminUiRoute =
    pathname.startsWith("/adminnarayan") &&
    !pathname.startsWith("/adminnarayan/login");

  if (isAdminUiRoute) {
    try {
      if (currentUser) {
        let isAdmin = false;

        try {
          const { data: checkAdmin, error: checkError } = await supabase.rpc(
            "check_is_admin",
            { p_user_id: currentUser.id }
          );
          if (!checkError && checkAdmin === true) {
            isAdmin = true;
          }
        } catch {}

        if (!isAdmin) {
          try {
            const { data: verificationResult, error: rpcError } =
              await supabase.rpc("verify_admin_login", {
                user_uuid: currentUser.id,
              });
            if (!rpcError && verificationResult?.[0]?.is_valid === true) {
              isAdmin = true;
            }
          } catch {}
        }

        if (!isAdmin) {
          return NextResponse.redirect(
            new URL("/adminnarayan/login?error=unauthorized", request.url)
          );
        }
      } else {
        return NextResponse.redirect(
          new URL("/adminnarayan/login", request.url)
        );
      }
    } catch {}
  }

  return response;
}

export const config = {
  matcher: [
    "/adminnarayan/:path*",
    "/api/admin/:path*",
    "/api/p2p/orders/:path*",
    "/api/jobs/:path*",
  ],
};
