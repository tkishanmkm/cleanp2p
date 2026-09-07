import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

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
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session
  const { data: { user } } = await supabase.auth.getUser();

  const url = request.nextUrl.clone();
  const isAdminRoute = url.pathname.startsWith('/adminnarayan') && !url.pathname.startsWith('/adminnarayan/login');

  if (isAdminRoute) {
    // 1. Unauthenticated users -> redirect to admin login
    if (!user) {
      url.pathname = '/adminnarayan/login';
      return NextResponse.redirect(url);
    }

    // 2. Check Role in App Metadata, Profiles Table, or verify RPC
    let userRole = user.app_metadata?.role;

    if (!userRole) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      
      userRole = profile?.role;
    }

    // Fallback: Check if verify_admin_login or check_is_admin returns true
    if (userRole !== 'admin') {
      const { data: isAdmin } = await supabase.rpc('check_is_admin', { p_user_id: user.id }).catch(() => ({ data: false }));
      if (isAdmin) {
        userRole = 'admin';
      }
    }

    // 3. Reject if not admin
    if (userRole !== 'admin') {
      url.pathname = '/unauthorized';
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/adminnarayan/:path*',
    '/api/admin/:path*',
    '/dashboard/:path*',
    '/wallets/:path*',
  ],
};
