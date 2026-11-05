import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

// This module contains only the public publishable/anon key. Privileged keys
// must never be prefixed NEXT_PUBLIC_ or imported by client components.
declare global {
  var __supabase_browser_client_instance__: SupabaseClient | undefined;
}

function getBrowserConfig(): { url: string; anonKey: string } {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  const localDevelopmentUrl =
    process.env.NODE_ENV !== 'production' &&
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url);

  if (!url || (!url.startsWith('https://') && !localDevelopmentUrl) || url.includes('placeholder')) {
    throw new Error('A valid Supabase HTTPS URL is required before initializing the browser client.');
  }
  if (!anonKey || anonKey.length < 20 || anonKey.includes('placeholder')) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY must contain the public Supabase key.');
  }

  return { url, anonKey };
}

export function getBrowserClient(): SupabaseClient {
  if (typeof window === 'undefined') {
    const { url, anonKey } = getBrowserConfig();
    return createBrowserClient(url, anonKey, {
      isSingleton: false,
      cookieOptions: { sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' },
    });
  }

  if (!globalThis.__supabase_browser_client_instance__) {
    const { url, anonKey } = getBrowserConfig();
    globalThis.__supabase_browser_client_instance__ = createBrowserClient(url, anonKey, {
      isSingleton: true,
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      cookieOptions: { sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' },
    });
  }

  return globalThis.__supabase_browser_client_instance__;
}

// Defer browser-client construction until a caller actually uses Supabase.
// Server routes often import shared modules that also serve client components;
// eager singleton creation here would validate browser environment variables
// while Next.js is collecting server route data during a production build.
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    const client = getBrowserClient();
    const value = Reflect.get(client, property, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
  set(_target, property, value) {
    const client = getBrowserClient();
    return Reflect.set(client, property, value, client);
  },
  has(_target, property) {
    return property in getBrowserClient();
  },
});

export default supabase;
