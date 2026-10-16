import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { ADMIN_2FA_COOKIE_NAME, verifyAdmin2FASessionToken } from '@/lib/admin-2fa-session';
import { USER_2FA_COOKIE_NAME, verifyUser2FASessionToken } from '@/lib/user-2fa-session';

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

  try {
    const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
    const supabase = createServerClient(
      supabaseUrl,
      supabaseKey,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value)
            );
            supabaseResponse = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            );
          },
        },
        global: {
          headers: authHeader ? { Authorization: authHeader } : undefined,
        },
      }
    );

    // Refresh session
    const { data: { user } } = await supabase.auth.getUser();

    const url = request.nextUrl.clone();

    // Check if user is banned across protected dashboard/wallet routes
    if (user && !url.pathname.startsWith('/dashboard/banned') && !url.pathname.startsWith('/api/')) {
      const { data: bannedCheck } = await supabase
        .from('profiles')
        .select('is_banned, status')
        .eq('id', user.id)
        .maybeSingle();

      if (bannedCheck && (bannedCheck.is_banned || bannedCheck.status === 'banned')) {
        url.pathname = '/dashboard/banned';
        return NextResponse.redirect(url);
      }
    }

    // Global Maintenance Mode & Prevent User Login Server-Side Enforcement
    const isMaintenanceOrLoginCheckPath =
      !url.pathname.startsWith('/adminnarayan') &&
      !url.pathname.startsWith('/api/admin') &&
      !url.pathname.startsWith('/api/cron') &&
      !url.pathname.startsWith('/api/webhooks') &&
      !url.pathname.startsWith('/api/didit/webhook') &&
      !url.pathname.startsWith('/api/kyc/webhook') &&
      !url.pathname.startsWith('/_next') &&
      !url.pathname.startsWith('/static') &&
      !url.pathname.startsWith('/login') &&
      !url.pathname.startsWith('/auth') &&
      !url.pathname.startsWith('/api/auth');

    if (isMaintenanceOrLoginCheckPath) {
      try {
        const { data: sysSettings } = await supabase
          .from('system_settings')
          .select('key, value')
          .in('key', ['emergency_mode', 'maintenance_mode', 'prevent_user_login']);

        const isEmergencyOn = sysSettings?.some((s: any) => s.key === 'emergency_mode' && (s.value === 'true' || s.value === true));
        const isMaintenanceOn = sysSettings?.some((s: any) => s.key === 'maintenance_mode' && (s.value === 'true' || s.value === true));
        const isPreventLoginOn = sysSettings?.some((s: any) => s.key === 'prevent_user_login' && (s.value === 'true' || s.value === true));

        if (isEmergencyOn || isMaintenanceOn || isPreventLoginOn) {
          let isAdmin = user?.app_metadata?.role === 'admin';
          if (!isAdmin && user) {
            const { data: prof } = await supabase
              .from('profiles')
              .select('role, is_admin, is_admin_account')
              .eq('id', user.id)
              .maybeSingle();
            isAdmin = prof?.role === 'admin' || prof?.is_admin === true || prof?.is_admin_account === true;
          }

          // If not admin, apply emergency / maintenance / login-disabled rules
          if (!isAdmin) {
            const errKey = isEmergencyOn ? 'emergency_mode' : (isMaintenanceOn ? 'maintenance' : 'login_disabled');
            const errCode = isEmergencyOn ? 'PLATFORM_EMERGENCY_MODE' : (isMaintenanceOn ? 'PLATFORM_MAINTENANCE_MODE' : 'PLATFORM_LOGIN_DISABLED');
            const errBaseMsg = isEmergencyOn
              ? 'Master Emergency Mode is active. Platform access is restricted to active trade participants.'
              : (isMaintenanceOn
                ? 'Maintenance mode is currently active. User access is temporarily disabled.'
                : 'User login is temporarily disabled by the administrator.');

            if (!user) {
              if (url.pathname.startsWith('/api/')) {
                return NextResponse.json(
                  { error: errBaseMsg, code: errCode },
                  { status: 503 }
                );
              }
              url.pathname = '/login';
              url.searchParams.set('error', errKey);
              return NextResponse.redirect(url);
            }

            // Normal user with active session: check active trades exception
            const { data: userTrades } = await supabase
              .from('trades')
              .select('id, status, is_disputed')
              .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`);

            const TERMINAL = new Set(['completed', 'released', 'cancelled', 'canceled', 'expired']);
            const activeTrades = (userTrades || []).filter((t: any) => {
              if (t.is_disputed === true) return true;
              const s = String(t.status || '').toLowerCase().trim();
              return s && !TERMINAL.has(s);
            });

            const isTradeRelatedPath =
              url.pathname.startsWith('/trade/') ||
              url.pathname.startsWith('/api/trades') ||
              url.pathname.startsWith('/api/p2p/trades') ||
              url.pathname.startsWith('/api/chat') ||
              url.pathname.startsWith('/api/messages') ||
              url.pathname.startsWith('/api/disputes');

            if (activeTrades.length > 0) {
              // User has active trade: allowed ONLY on trade-related routes for THEIR OWN active trade(s)
              const activeTradeIds = new Set(activeTrades.map((t: any) => String(t.id)));

              if (url.pathname.startsWith('/trade/')) {
                const targetTradeId = url.pathname.replace(/^\/trade\//, '').split('/')[0];
                if (targetTradeId && !activeTradeIds.has(targetTradeId)) {
                  // User tried to access a trade that is not their active trade -> redirect to their active trade
                  url.pathname = `/trade/${activeTrades[0].id}`;
                  return NextResponse.redirect(url);
                }
              } else if (!isTradeRelatedPath) {
                // Redirect user from unrelated routes back to their primary active trade
                url.pathname = `/trade/${activeTrades[0].id}`;
                return NextResponse.redirect(url);
              }
            } else {
              // Normal user has NO active trades: blocked under emergency / maintenance / login-disabled
              if (url.pathname.startsWith('/api/')) {
                return NextResponse.json(
                  { error: errBaseMsg, code: errCode },
                  { status: 503 }
                );
              }
              url.pathname = '/login';
              url.searchParams.set('error', errKey);
              return NextResponse.redirect(url);
            }
          }
        }
      } catch (mErr) {
        console.warn('Maintenance check warning in middleware:', mErr);
      }
    }

    // Redirect legacy admin routes (/admin, /admin/*, /adminanarayan, /adminanarayan/*) to canonical /adminnarayan
    const isLegacyAdminRoute = 
      url.pathname === '/admin' || 
      url.pathname.startsWith('/admin/') || 
      url.pathname === '/adminanarayan' || 
      url.pathname.startsWith('/adminanarayan/');

    if (isLegacyAdminRoute) {
      if (url.pathname.startsWith('/admin/disputes')) {
        url.pathname = '/adminnarayan/disputes';
      } else {
        url.pathname = '/adminnarayan';
      }
      return NextResponse.redirect(url);
    }

    const isAdminRoute = (url.pathname.startsWith('/adminnarayan') && !url.pathname.startsWith('/adminnarayan/login')) || url.pathname.startsWith('/api/admin');

    if (isAdminRoute) {
      // 1. Unauthenticated users -> redirect to admin login or return 401 for API
      if (!user) {
        if (url.pathname.startsWith('/api/admin')) {
          return NextResponse.json({ success: false, error: 'Authentication required. Admin privileges needed.' }, { status: 401 });
        }
        url.pathname = '/adminnarayan/login';
        return NextResponse.redirect(url);
      }

      // 2. Check Role in App Metadata, Profiles Table, or verify RPC
      let userRole = user.app_metadata?.role;

      if (!userRole) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role, is_admin')
          .eq('id', user.id)
          .maybeSingle();
        
        userRole = (profile?.role === 'admin' || profile?.is_admin === true) ? 'admin' : profile?.role;
      }

      // Fallback: Check if verify_admin_login or check_is_admin returns true
      if (userRole !== 'admin') {
        try {
          const { data: isAdmin } = await supabase.rpc('check_is_admin', { p_user_id: user.id });
          if (isAdmin) {
            userRole = 'admin';
          }
        } catch (_) {
          // ignore RPC error
        }
      }

      // 3. Reject if not admin
      if (userRole !== 'admin') {
        if (url.pathname.startsWith('/api/admin')) {
          return NextResponse.json({ success: false, error: 'Access denied. Administrator privileges required.' }, { status: 403 });
        }
        url.pathname = '/unauthorized';
        return NextResponse.redirect(url);
      }

      // 4. Admin 2FA Enforcement Gate
      const is2FAExemptRoute =
        url.pathname === '/adminnarayan/login' ||
        url.pathname === '/adminnarayan/login/challenge' ||
        url.pathname === '/api/admin/auth/2fa-challenge' ||
        url.pathname === '/api/admin/auth/verify-captcha' ||
        url.pathname === '/api/admin/security/status';

      if (!is2FAExemptRoute) {
        const { data: adminProf } = await supabase
          .from('profiles')
          .select('admin_2fa_enabled, is_2fa_enabled, admin_2fa_recovery_updated_at')
          .eq('id', user.id)
          .maybeSingle();

        const is2FAActive = Boolean(adminProf?.admin_2fa_enabled || adminProf?.is_2fa_enabled);

        if (is2FAActive) {
          const sessionCookie = request.cookies.get(ADMIN_2FA_COOKIE_NAME)?.value;
          const securityVersion = adminProf?.admin_2fa_recovery_updated_at || user.id;
          const verification = verifyAdmin2FASessionToken(sessionCookie, user.id, securityVersion);

          if (!verification.valid) {
            if (url.pathname.startsWith('/api/admin')) {
              return NextResponse.json(
                { success: false, error: 'Admin 2FA verification required.', code: '2FA_REQUIRED' },
                { status: 403 }
              );
            }

            url.pathname = '/adminnarayan/login/challenge';
            url.searchParams.set('redirectTo', request.nextUrl.pathname);
            return NextResponse.redirect(url);
          }
        }
      }
    } else if (user) {
      // 5. User 2FA Enforcement Gate for authenticated regular users
      const isUser2FAExemptRoute =
        url.pathname.startsWith('/login') ||
        url.pathname.startsWith('/auth') ||
        url.pathname.startsWith('/api/auth') ||
        url.pathname.startsWith('/api/webhooks') ||
        url.pathname.startsWith('/api/cron') ||
        url.pathname.startsWith('/api/didit/webhook') ||
        url.pathname.startsWith('/api/kyc/webhook') ||
        url.pathname === '/dashboard/banned' ||
        url.pathname === '/unauthorized';

      if (!isUser2FAExemptRoute) {
        const { data: userProf } = await supabase
          .from('profiles')
          .select('is_2fa_enabled, is_mfa_enabled, two_factor_enabled, updated_at')
          .eq('id', user.id)
          .maybeSingle();

        const isUser2FAActive = Boolean(
          userProf?.is_2fa_enabled ||
          userProf?.is_mfa_enabled ||
          userProf?.two_factor_enabled
        );

        if (isUser2FAActive) {
          const sessionCookie = request.cookies.get(USER_2FA_COOKIE_NAME)?.value;
          const securityVersion = userProf?.updated_at || user.id;
          const verification = verifyUser2FASessionToken(sessionCookie, user.id, securityVersion);

          if (!verification.valid) {
            if (url.pathname.startsWith('/api/')) {
              return NextResponse.json(
                { success: false, error: 'User 2FA verification required.', code: '2FA_REQUIRED' },
                { status: 403 }
              );
            }

            url.pathname = '/auth/2fa';
            url.searchParams.set('next', request.nextUrl.pathname + (request.nextUrl.search || ''));
            return NextResponse.redirect(url);
          }
        }
      }
    }
  } catch (e) {
    // Do not silently allow API requests to proceed when authentication/security
    // checks could not be completed. Financial and privileged handlers must fail closed.
    console.error('Middleware security check failed:', e);
    const pathname = request.nextUrl.pathname;

    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, error: 'Security checks temporarily unavailable.', code: 'SECURITY_CHECK_UNAVAILABLE' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // Keep public pages available, but fail closed for protected application areas.
    const protectedPage = [
      '/adminnarayan', '/dashboard', '/wallet', '/deposit', '/withdraw',
      '/transactions', '/trade', '/ads', '/profile', '/settings'
    ].some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'));

    if (protectedPage) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('error', 'security_check_unavailable');
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
