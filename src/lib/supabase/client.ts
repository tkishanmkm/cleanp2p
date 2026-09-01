import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || 'placeholder-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

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
