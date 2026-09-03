import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        sameSite: "none",
        secure: true,
        path: "/",
      },
    }
  );
}

// Default singleton client for existing application components
export const supabase = createClient();

export function checkSupabaseConfig(): { isConfigured: boolean; hasUrl: boolean; hasAnonKey: boolean; url: string } {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();

  const hasUrl = Boolean(
    url &&
    url !== 'https://placeholder.supabase.co' &&
    !url.includes('placeholder.supabase.co') &&
    (url.startsWith('https://') || url.startsWith('http://'))
  );

  const hasAnonKey = Boolean(
    key &&
    key !== 'placeholder-anon-key' &&
    key !== 'placeholder-key' &&
    key.length > 20
  );

  return {
    isConfigured: hasUrl && hasAnonKey,
    hasUrl,
    hasAnonKey,
    url: hasUrl ? url : '',
  };
}
