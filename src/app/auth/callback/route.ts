import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const requestUrl = new URL(request.url);
    const code = requestUrl.searchParams.get('code');
    const next = requestUrl.searchParams.get('next') ?? '/dashboard';
    const origin = requestUrl.origin;

    if (code) {
      const supabase = await createClient();
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      if (!error && data?.user) {
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
