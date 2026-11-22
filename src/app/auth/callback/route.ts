import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const requestUrl = new URL(request.url);
    const code = requestUrl.searchParams.get('code');
    const next = requestUrl.searchParams.get('next') ?? '/dashboard';
    const origin = requestUrl.origin;

    const errorCode = requestUrl.searchParams.get('error');
    const errorDescription = requestUrl.searchParams.get('error_description');

    if (errorCode || errorDescription) {
      if (next.startsWith('/reset-password')) {
        const resetRedirect = new URL(`${origin}/reset-password`);
        resetRedirect.searchParams.set('error', errorDescription || errorCode || 'Verification failed');
        return NextResponse.redirect(resetRedirect.toString());
      }
      const errorRedirect = new URL(`${origin}/auth/auth-code-error`);
      if (errorCode) errorRedirect.searchParams.set('error', errorCode);
      if (errorDescription) errorRedirect.searchParams.set('error_description', errorDescription);
      return NextResponse.redirect(errorRedirect.toString());
    }

    if (code) {
      const supabase = await createClient();
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      if (!error && data?.user) {
        const user = data.user;

        // Check if profile exists; if not, create with username_changed = false
        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('id, username_changed, username_changes_remaining, username_changed_count')
            .eq('id', user.id)
            .maybeSingle();

          if (!profile) {
            // Auth signup trigger owns profile creation and the sequence-backed
            // wallet_index. Never synthesize an unindexed profile in an OAuth callback.
            console.error('[Auth Callback] Signup profile is missing; database allocator/trigger reconciliation is required.', {
              userId: user.id,
            });
          } else if (profile.username_changed === null || profile.username_changed === undefined || profile.username_changes_remaining === null || profile.username_changes_remaining === undefined) {
            // Profile created by database trigger without explicit flags: grant 1-time username change
            await supabase
              .from('profiles')
              .update({
                username_changed: false,
                username_changes_remaining: 1,
                username_changed_count: 0,
              })
              .eq('id', user.id);
          }
        } catch (profileErr) {
          console.error('[Auth Callback] Error checking/creating OAuth profile:', profileErr);
        }

        // Provision addresses with the user token returned by the code exchange.
        // A server-side fetch does not inherit the browser's Supabase cookies.
        try {
          const accessToken = data.session?.access_token;
          if (!accessToken) {
            throw new Error('OAuth session access token is unavailable for authenticated wallet provisioning.');
          }

          const provisionResponse = await fetch(`${origin}/api/auth/provision-wallets`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ userId: data.user.id }),
            cache: 'no-store',
          });

          if (!provisionResponse.ok) {
            const provisionResult = await provisionResponse.json().catch(() => null);
            console.error('[Auth Callback] Wallet provisioning was rejected:', {
              status: provisionResponse.status,
              code: provisionResult?.code || null,
              error: provisionResult?.error || 'No error details returned',
              userId: data.user.id,
            });
          }
        } catch (err) {
          console.error('[Auth Callback] Wallet provisioning failed:', err instanceof Error ? err.message : 'unknown error');
        }

        // Check if user has 2FA enabled; if so, redirect to 2FA challenge before protected routes
        try {
          const { data: user2FAProfile } = await supabase
            .from('profiles')
            .select('is_2fa_enabled, is_mfa_enabled, two_factor_enabled')
            .eq('id', user.id)
            .maybeSingle();

          const is2FAActive = Boolean(
            user2FAProfile?.is_2fa_enabled ||
            user2FAProfile?.is_mfa_enabled ||
            user2FAProfile?.two_factor_enabled
          );

          if (is2FAActive) {
            const challengeUrl = new URL(`${origin}/auth/2fa`);
            challengeUrl.searchParams.set('next', next.startsWith('/') ? next : '/dashboard');
            return NextResponse.redirect(challengeUrl.toString());
          }
        } catch (err2fa) {
          console.error('[Auth Callback] Error checking 2FA state:', err2fa);
        }

        const destination = next.startsWith('/') ? `${origin}${next}` : `${origin}/dashboard`;
        return NextResponse.redirect(destination);
      }

      console.error('[Auth Callback] exchangeCodeForSession error:', error?.message);
    }

    return NextResponse.redirect(`${origin}/auth/auth-code-error`);
  } catch (err) {
    console.error('[Auth Callback] Unexpected error during code exchange:', err);
    const fallbackOrigin = new URL(request.url).origin;
    return NextResponse.redirect(`${fallbackOrigin}/auth/auth-code-error`);
  }
}
