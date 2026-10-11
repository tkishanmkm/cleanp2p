import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const error = requestUrl.searchParams.get('error');
  const errorDescription = requestUrl.searchParams.get('error_description');

  if (error) {
    console.error('OAuth Callback Error:', error, errorDescription);
  }

  let requires2FA = false;

  if (code) {
    try {
      const supabase = await createClient();
      const { data, error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
      if (!exchangeErr && data?.user) {
        const user = data.user;

        try {
          const { data: user2FAProfile } = await supabase
            .from('profiles')
            .select('is_2fa_enabled, is_mfa_enabled, two_factor_enabled')
            .eq('id', user.id)
            .maybeSingle();

          requires2FA = Boolean(
            user2FAProfile?.is_2fa_enabled ||
            user2FAProfile?.is_mfa_enabled ||
            user2FAProfile?.two_factor_enabled
          );
        } catch (_) {}

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
          console.error('[OAuth Callback] Error checking/creating OAuth profile:', profileErr);
        }

        try {
          await fetch(`${requestUrl.origin}/api/auth/provision-wallets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: data.user.id }),
          });
        } catch (provErr) {
          console.error('[OAuth Callback] Auto-provisioning notice:', provErr);
        }
      }
    } catch (exchangeErr) {
      console.error('Session exchange error:', exchangeErr);
    }
  }

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Authenticating...</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f1423; color: #fff; }
    .spinner { width: 32px; height: 32px; border: 3px solid rgba(255,255,255,0.2); border-top-color: #3b82f6; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 16px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .box { text-align: center; }
  </style>
</head>
<body>
  <div class="box">
    <div class="spinner"></div>
    <div>Authentication complete. Redirecting...</div>
  </div>
  <script>
    try {
      var req2FA = ${requires2FA ? 'true' : 'false'};
      if (window.opener) {
        window.opener.postMessage({ type: req2FA ? 'OAUTH_2FA_REQUIRED' : 'OAUTH_AUTH_SUCCESS' }, '*');
        if (req2FA) {
          window.location.href = '/auth/2fa';
        } else {
          setTimeout(function() { window.close(); }, 600);
        }
      } else {
        window.location.href = req2FA ? '/auth/2fa' : '/buy';
      }
    } catch (e) {
      window.location.href = '/buy';
    }
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
}
