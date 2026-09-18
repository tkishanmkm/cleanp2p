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
            const shortId = user.id.replace(/-/g, '').slice(0, 8);
            const generatedUsername = `user_${shortId}`;
            const meta = user.user_metadata || {};
            const fullName = meta.full_name || meta.name || '';
            const avatarUrl = meta.avatar_url || meta.picture || null;

            await supabase.from('profiles').insert({
              id: user.id,
              email: user.email,
              username: generatedUsername,
              full_name: fullName,
              display_name: fullName || generatedUsername,
              avatar_url: avatarUrl,
              photo_url: avatarUrl,
              username_changed: false, // Ensure 1-time change option is granted
              username_changes_remaining: 1,
              username_changed_count: 0,
              role: 'user',
              status: 'active',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
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

        // Provision deposit addresses asynchronously in the background
        try {
          fetch(`${origin}/api/auth/provision-wallets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: data.user.id }),
          }).catch((err) => {
            console.error('[Auth Callback] Wallet provisioning fetch error:', err);
          });
        } catch (err) {
          console.error('[Auth Callback] Failed to trigger wallet provisioning:', err);
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
