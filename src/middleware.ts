import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import {
  ADMIN_2FA_COOKIE_NAME,
  USER_2FA_COOKIE_NAME,
  verifyAdmin2FASessionTokenEdge,
  verifyUser2FASessionTokenEdge,
} from '@/lib/2fa-session-edge';

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Never send auth requests to placeholder hosts when local configuration is absent.
  // Public entry pages can render, but protected pages/APIs fail closed until configured.
  if (
    !supabaseUrl ||
    !supabaseKey ||
    /placeholder|your[_-]?project|your[_-]?anon[_-]?key/i.test(supabaseUrl + ' ' + supabaseKey)
  ) {
    const pathname = request.nextUrl.pathname;
    const isStaticAsset =
      pathname.startsWith('/_next/') ||
      pathname.startsWith('/static/') ||
      /\.(?:ico|png|jpg|jpeg|gif|webp|svg|css|js|woff2?)$/i.test(pathname);
    const isPublicEntry =
      pathname === '/' ||
      pathname.startsWith('/login') ||
      pathname.startsWith('/signup') ||
      pathname.startsWith('/auth');

    if (isStaticAsset || isPublicEntry) {
      return supabaseResponse;
    }

    return NextResponse.json(
      { error: 'Authentication service is not configured. Configure Supabase environment variables before accessing protected routes.', code: 'AUTH_SERVICE_NOT_CONFIGURED' },
      { status: 503 }
    );
  }

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

    // Enforce account lifecycle status on protected pages and APIs, not only in the UI.
    // Public profile pages remain reachable so visitors can see a deleted/banned/restricted tombstone.
    const isPublicAccountRoute =
      url.pathname === '/login' ||
      url.pathname.startsWith('/login/') ||
      url.pathname === '/signup' ||
      url.pathname.startsWith('/signup/') ||
      url.pathname.startsWith('/api/cron/') ||
      url.pathname.startsWith('/api/webhooks/') ||
      url.pathname.startsWith('/api/didit/webhook') ||
      url.pathname.startsWith('/api/kyc/webhook') ||
      url.pathname.startsWith('/users/') ||
      url.pathname.startsWith('/user/') ||
      url.pathname.startsWith('/support') ||
      url.pathname.startsWith('/contact') ||
      url.pathname.startsWith('/_next/') ||
      url.pathname.startsWith('/static/') ||
      url.pathname === '/robots.txt' ||
      url.pathname === '/sitemap.xml';

    if (user && !isPublicAccountRoute && !url.pathname.startsWith('/dashboard/banned')) {
      const { data: accountState, error: accountStateError } = await supabase
        .from('profiles')
        .select('is_banned, is_suspended, is_restricted, is_on_hold, is_emergency_frozen, is_minor_restricted, status, account_status')
        .eq('id', user.id)
        .maybeSingle();

      if (accountStateError || !accountState) {
        if (url.pathname.startsWith('/api/')) {
          return NextResponse.json(
            { error: 'Account status could not be verified. Please retry.', code: 'ACCOUNT_STATUS_UNAVAILABLE' },
            { status: 503 }
          );
        }
        url.pathname = '/login';
        url.searchParams.set('error', 'account_status_unavailable');
        return NextResponse.redirect(url);
      }

      const status = String(accountState.status || '').toLowerCase();
      const accountStatus = String(accountState.account_status || '').toUpperCase();
      const isDeletionPending = accountStatus === 'DELETION_PENDING';
      const isDeleted = accountStatus === 'DELETED' || status === 'deleted';
      const isBanned = accountState.is_banned === true || status === 'banned' || accountStatus === 'BANNED';
      const isSuspended = accountState.is_suspended === true || status === 'suspended' || accountStatus === 'SUSPENDED';
      const isRestricted =
        accountState.is_restricted === true ||
        status === 'restricted' ||
        accountStatus === 'RESTRICTED';
      const isOnHold =
        accountState.is_on_hold === true ||
        ['ON_HOLD', 'HOLD', 'BLOCKED'].includes(accountStatus);
      const isEmergencyFrozen = accountState.is_emergency_frozen === true;
      const isMinorRestricted = accountState.is_minor_restricted === true;

      if (isDeletionPending || isDeleted) {
        if (url.pathname.startsWith('/api/')) {
          return NextResponse.json(
            {
              error: isDeleted ? 'This account has been deleted and cannot access the platform.' : 'This account is scheduled for deletion and access is disabled.',
              code: isDeleted ? 'ACCOUNT_DELETED' : 'ACCOUNT_DELETION_PENDING',
            },
            { status: 403 }
          );
        }
        url.pathname = '/login';
        url.searchParams.set('error', isDeleted ? 'account_deleted' : 'account_deletion_pending');
        return NextResponse.redirect(url);
      }

      if (isBanned) {
        if (url.pathname.startsWith('/api/')) {
          return NextResponse.json(
            { error: 'This account is banned and cannot access the platform.', code: 'ACCOUNT_BANNED' },
            { status: 403 }
          );
        }
        url.pathname = '/dashboard/banned';
        return NextResponse.redirect(url);
      }

      if (isSuspended || isRestricted || isOnHold || isEmergencyFrozen || isMinorRestricted) {
        const restrictionCode = isSuspended
          ? 'ACCOUNT_SUSPENDED'
          : isRestricted
            ? 'ACCOUNT_RESTRICTED'
            : isOnHold
              ? 'ACCOUNT_ON_HOLD'
              : isEmergencyFrozen
                ? 'ACCOUNT_EMERGENCY_FROZEN'
                : 'ACCOUNT_MINOR_RESTRICTED';
        const restrictionMessage = isSuspended
          ? 'This account is suspended and cannot access protected actions.'
          : isRestricted
            ? 'This account is restricted and cannot access protected actions.'
            : isOnHold
              ? 'This account is on hold and cannot access protected actions.'
              : isEmergencyFrozen
                ? 'This account is temporarily frozen and cannot access protected actions.'
                : 'This account is restricted from platform actions.';

        if (url.pathname.startsWith('/api/')) {
          return NextResponse.json(
            { error: restrictionMessage, code: restrictionCode },
            { status: 403 }
          );
        }
        url.pathname = '/login';
        url.searchParams.set(
          'error',
          isSuspended ? 'account_suspended'
            : isRestricted ? 'account_restricted'
              : isOnHold ? 'account_on_hold'
                : isEmergencyFrozen ? 'account_frozen'
                  : 'account_minor_restricted'
        );
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
        // Read only the three allowlisted, non-secret operational flags. RLS and
        // column grants prevent clients from reading other settings or writing rows.
        const { data: sysSettings, error: sysSettingsError } = await supabase.rpc(
          'get_public_platform_control_flags'
        );

        const readControlFlag = (key: string): boolean | null => {
          const row = Array.isArray(sysSettings)
            ? sysSettings.find((setting: any) => setting.key === key)
            : null;
          if (!row || row.value === null || row.value === undefined) return null;
          if (row.value === true || row.value === 'true' || row.value === 1 || row.value === '1') return true;
          if (row.value === false || row.value === 'false' || row.value === 0 || row.value === '0') return false;
          return null;
        };

        // Emergency controls are security controls: never treat an unavailable or
        // missing setting as "off". Fail closed for user-facing routes.
        const emergencyModeValue = readControlFlag('emergency_mode');
        const maintenanceModeValue = readControlFlag('maintenance_mode');
        const preventLoginValue = readControlFlag('prevent_user_login');
        const emergencySettingAvailable =
          emergencyModeValue !== null &&
          maintenanceModeValue !== null &&
          preventLoginValue !== null;

        if (sysSettingsError || !emergencySettingAvailable) {
          console.error('Platform emergency control state unavailable:', sysSettingsError?.message || 'emergency_mode setting missing');
          if (url.pathname.startsWith('/api/')) {
            return NextResponse.json(
              { error: 'Platform access controls could not be verified. Please retry.', code: 'PLATFORM_CONTROL_STATE_UNAVAILABLE' },
              { status: 503 }
            );
          }
          url.pathname = '/login';
          url.searchParams.set('error', 'platform_controls_unavailable');
          return NextResponse.redirect(url);
        }

        const isEmergencyOn = emergencyModeValue === true;
        const isMaintenanceOn = maintenanceModeValue === true;
        const isPreventLoginOn = preventLoginValue === true;

        if (isEmergencyOn || isMaintenanceOn || isPreventLoginOn) {
          let isAdmin = user?.app_metadata?.role === 'admin';
          if (!isAdmin && user) {
            // Protected profile role columns are intentionally not readable by
            // browser-authenticated clients. Use the self-scoped trusted DB helper.
            const { data: verifiedAdmin, error: adminCheckError } = await supabase.rpc('is_admin');
            if (adminCheckError) {
              console.error('Unable to verify administrator access during platform lockdown:', adminCheckError.message);
              if (url.pathname.startsWith('/api/')) {
                return NextResponse.json(
                  { error: 'Administrator status could not be verified.', code: 'ADMIN_STATUS_UNAVAILABLE' },
                  { status: 503 }
                );
              }
              url.pathname = '/login';
              url.searchParams.set('error', 'admin_status_unavailable');
              return NextResponse.redirect(url);
            }
            isAdmin = verifiedAdmin === true;
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
        // A thrown request or parsing failure must not silently disable platform controls.
        console.error('Platform emergency control enforcement failed:', mErr);
        if (url.pathname.startsWith('/api/')) {
          return NextResponse.json(
            { error: 'Platform access controls could not be verified. Please retry.', code: 'PLATFORM_CONTROL_STATE_UNAVAILABLE' },
            { status: 503 }
          );
        }
        url.pathname = '/login';
        url.searchParams.set('error', 'platform_controls_unavailable');
        return NextResponse.redirect(url);
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

      // 2. Use the canonical admin-verification RPC. Do not trust role metadata
      // or profile flags alone, and do not fall back to an RPC whose production
      // EXECUTE grant is unavailable to authenticated callers.
      const { data: verificationResult, error: verificationError } = await supabase.rpc(
        'verify_admin_login',
        { user_uuid: user.id }
      );

      if (verificationError) {
        // Fail closed when the canonical authorization source is unavailable.
        if (url.pathname.startsWith('/api/admin')) {
          return NextResponse.json(
            { success: false, error: 'Administrator privileges could not be verified.', code: 'ADMIN_VERIFICATION_UNAVAILABLE' },
            { status: 503 }
          );
        }
        url.pathname = '/adminnarayan/login';
        url.searchParams.set('error', 'verification_unavailable');
        return NextResponse.redirect(url);
      }

      const isVerifiedAdmin = verificationResult?.[0]?.is_valid === true;

      // 3. Reject users whose canonical admin verification fails.
      if (!isVerifiedAdmin) {
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
          const verification = await verifyAdmin2FASessionTokenEdge(sessionCookie, user.id, securityVersion);

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
          const verification = await verifyUser2FASessionTokenEdge(sessionCookie, user.id, securityVersion);

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
    // Do not let an Auth/network failure bypass page, admin, or API guards.
    console.error('Middleware authentication enforcement failed:', e);
    const pathname = request.nextUrl.pathname;
    const isStaticAsset =
      pathname.startsWith('/_next/') ||
      pathname.startsWith('/static/') ||
      /\.(?:ico|png|jpg|jpeg|gif|webp|svg|css|js|woff2?)$/i.test(pathname);
    const isPublicPage =
      pathname === '/' ||
      pathname === '/login' ||
      pathname.startsWith('/login/') ||
      pathname === '/signup' ||
      pathname.startsWith('/signup/') ||
      pathname.startsWith('/auth/') ||
      pathname === '/support' ||
      pathname.startsWith('/support/') ||
      pathname === '/contact' ||
      pathname.startsWith('/contact/') ||
      pathname.startsWith('/users/') ||
      pathname.startsWith('/user/') ||
      pathname === '/adminnarayan/login' ||
      pathname.startsWith('/adminnarayan/login/') ||
      pathname === '/robots.txt' ||
      pathname === '/sitemap.xml';
    // These handlers have independent HMAC/secret authentication and must
    // still validate that credential themselves before processing a request.
    const isSelfAuthenticatingEndpoint =
      pathname.startsWith('/api/cron/') ||
      pathname.startsWith('/api/webhooks/') ||
      pathname.startsWith('/api/didit/webhook') ||
      pathname.startsWith('/api/kyc/webhook');

    if (isStaticAsset || isPublicPage || isSelfAuthenticatingEndpoint) {
      return supabaseResponse;
    }

    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, error: 'Authentication service is temporarily unavailable.', code: 'AUTH_SERVICE_UNAVAILABLE' },
        { status: 503 }
      );
    }

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('error', 'authentication_unavailable');
    return NextResponse.redirect(loginUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
