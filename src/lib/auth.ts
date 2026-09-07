import { supabase, checkSupabaseConfig } from './supabase/client';
import type { User, Session } from '@supabase/supabase-js';

import { sanitizeUsername } from './utils';

export interface UserProfile {
  id: string;
  username?: string | null;
  email?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  country?: string | null;
  preferredCurrency?: string;
  preferred_currency?: string;
  role: 'user' | 'admin' | 'moderator';
  is_admin: boolean;
  status: 'active' | 'suspended' | 'banned';
  btc_balance?: number;
  eth_balance?: number;
  usdt_balance?: number;
  ltc_balance?: number;
  btcBalance?: number;
  ethBalance?: number;
  usdtBalance?: number;
  ltcBalance?: number;
  wallets?: Record<string, { balance: number; lockedBalance?: number }>;
  last_active?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthActionResult<T = any> {
  data: T | null;
  error: Error | null;
}

function handleAuthError(err: unknown): Error {
  if (!err) return new Error('An unknown authentication error occurred.');
  const msg = err instanceof Error ? err.message : String(err);

  if (
    msg.toLowerCase().includes('failed to fetch') ||
    msg.toLowerCase().includes('networkerror') ||
    msg.toLowerCase().includes('fetch failed') ||
    msg.toLowerCase().includes('enotfound')
  ) {
    const config = checkSupabaseConfig();
    if (!config.isConfigured) {
      return new Error(
        'Supabase is not yet configured. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Settings > Secrets.'
      );
    }
    return new Error(
      'Unable to connect to Supabase (Failed to fetch). Please check your internet connection and ensure your Supabase project is active and URL is valid.'
    );
  }

  if (
    msg.toLowerCase().includes('invalid login credentials') ||
    msg.toLowerCase().includes('invalid credentials') ||
    msg.toLowerCase().includes('invalid email or password')
  ) {
    return new Error('Invalid email or password. Please check your credentials and try again.');
  }

  if (msg.toLowerCase().includes('email not confirmed')) {
    return new Error('Your email address has not been confirmed yet. Please verify your email inbox.');
  }

  return new Error(msg);
}

/**
 * Sign in a user with email and password via Supabase Auth.
 */
export async function signInWithEmail(email: string, password: string): Promise<AuthActionResult<{ user: User | null; session: Session | null }>> {
  try {
    const { isConfigured } = checkSupabaseConfig();
    if (!isConfigured) {
      return {
        data: null,
        error: new Error('Supabase is not configured yet. Please configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Settings.'),
      };
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (error) {
      return { data: null, error: handleAuthError(error) };
    }

    return { data, error: null };
  } catch (err: unknown) {
    return { data: null, error: handleAuthError(err) };
  }
}

/**
 * Sign in a user with either an Email address or Username via Supabase Auth.
 * Automatically resolves username to the registered email before authentication.
 */
export async function signInWithIdentifier(
  identifier: string,
  password: string
): Promise<AuthActionResult<{ user: User | null; session: Session | null }>> {
  try {
    const trimmed = identifier.trim();
    if (!trimmed) {
      return { data: null, error: new Error('Please enter your email or username.') };
    }

    const { isConfigured } = checkSupabaseConfig();
    if (!isConfigured) {
      return {
        data: null,
        error: new Error('Supabase is not configured yet. Please configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Settings.'),
      };
    }

    let targetEmail = trimmed;

    // If identifier is not an email (does not contain '@'), resolve via profiles table
    if (!trimmed.includes('@')) {
      try {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('email')
          .ilike('username', trimmed)
          .maybeSingle();

        if (profileError || !profile?.email) {
          return {
            data: null,
            error: new Error('No account found with this username. Please check your username or use your email address.'),
          };
        }

        targetEmail = profile.email;
      } catch (profileErr) {
        return {
          data: null,
          error: handleAuthError(profileErr),
        };
      }
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: targetEmail.toLowerCase(),
      password,
    });

    if (error) {
      return { data: null, error: handleAuthError(error) };
    }

    return { data, error: null };
  } catch (err: unknown) {
    return { data: null, error: handleAuthError(err) };
  }
}

/**
 * Generates a random, unique username for newly registered users.
 * Example: trader_48291
 */
export function generateUniqueUsername(): string {
  const randomSuffix = Math.floor(10000 + Math.random() * 90000);
  return `trader_${randomSuffix}`;
}

/**
 * Sign up a new user with email, password, and metadata via Supabase Auth.
 */
export async function signUpWithEmail(
  email: string,
  password: string,
  metadata?: { username?: string; displayName?: string }
): Promise<AuthActionResult<{ user: User | null; session: Session | null; assignedUsername: string }>> {
  try {
    const { isConfigured } = checkSupabaseConfig();
    if (!isConfigured) {
      return {
        data: null,
        error: new Error('Supabase is not configured yet. Please configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Settings.'),
      };
    }

    // Automatically generate a unique username if not provided
    const resolvedUsername = metadata?.username ? sanitizeUsername(metadata.username) : generateUniqueUsername();
    const resolvedDisplayName = metadata?.displayName || metadata?.username || resolvedUsername;

    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: {
          username: resolvedUsername,
          display_name: resolvedDisplayName,
        },
      },
    });

    if (error) {
      return { data: null, error: handleAuthError(error) };
    }

    // Ensure profile row exists in profiles table with username_changed = false
    if (data.user) {
      try {
        await supabase.from('profiles').upsert({
          id: data.user.id,
          email: data.user.email,
          username: resolvedUsername,
          display_name: resolvedDisplayName,
          role: 'user',
          is_admin: false,
          status: 'active',
          username_changed: false,
          updated_at: new Date().toISOString(),
        });
      } catch (upsertErr) {
        console.warn('Non-blocking profile upsert notice:', upsertErr);
      }
    }

    return { 
      data: { 
        user: data.user, 
        session: data.session, 
        assignedUsername: resolvedUsername 
      }, 
      error: null 
    };
  } catch (err: unknown) {
    return { data: null, error: handleAuthError(err) };
  }
}

/**
 * Sign out the currently authenticated user.
 */
export async function signOut(): Promise<AuthActionResult<void>> {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      return { data: null, error: handleAuthError(error) };
    }
    return { data: null, error: null };
  } catch (err: unknown) {
    return { data: null, error: handleAuthError(err) };
  }
}

/**
 * Get the currently authenticated user from Supabase.
 */
export async function getCurrentUser(): Promise<User | null> {
  try {
    const { isConfigured } = checkSupabaseConfig();
    if (!isConfigured) return null;
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  } catch (err) {
    console.error('Error fetching current user:', err);
    return null;
  }
}

/**
 * Get the current active session from Supabase.
 */
export async function getCurrentSession(): Promise<Session | null> {
  try {
    const { isConfigured } = checkSupabaseConfig();
    if (!isConfigured) return null;
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  } catch (err) {
    console.error('Error fetching current session:', err);
    return null;
  }
}

/**
 * Fetches user profile record directly from the Supabase `profiles` table.
 */
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  try {
    const { isConfigured } = checkSupabaseConfig();
    if (!isConfigured) return null;

    let { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (!data) {
      const fallback = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
      if (fallback.data) {
        data = fallback.data;
        error = null;
      }
    }

    if (error || !data) {
      return null;
    }

    const btcVal = Number(data.btc_balance ?? data.btcBalance ?? data.wallets?.BTC?.balance ?? 0);
    const ethVal = Number(data.eth_balance ?? data.ethBalance ?? data.wallets?.ETH?.balance ?? 0);
    const usdtVal = Number(data.usdt_balance ?? data.usdtBalance ?? data.wallets?.USDT?.balance ?? 0);
    const ltcVal = Number(data.ltc_balance ?? data.ltcBalance ?? data.wallets?.LTC?.balance ?? 0);

    return {
      id: data.id || data.user_id,
      username: data.username,
      email: data.email,
      display_name: data.display_name || data.username,
      avatar_url: data.avatar_url,
      country: data.country || data.ip_based_country || null,
      preferredCurrency: data.preferred_currency || data.preferredCurrency || 'USD',
      preferred_currency: data.preferred_currency || data.preferredCurrency || 'USD',
      role: data.role || (data.is_admin ? 'admin' : 'user'),
      is_admin: Boolean(data.is_admin || data.role === 'admin'),
      status: data.status || 'active',
      btc_balance: btcVal,
      eth_balance: ethVal,
      usdt_balance: usdtVal,
      ltc_balance: ltcVal,
      btcBalance: btcVal,
      ethBalance: ethVal,
      usdtBalance: usdtVal,
      ltcBalance: ltcVal,
      wallets: data.wallets || undefined,
      last_active: data.last_active,
      created_at: data.created_at || new Date().toISOString(),
      updated_at: data.updated_at || new Date().toISOString(),
    };
  } catch (err) {
    console.error('Error fetching user profile:', err);
    return null;
  }
}

/**
 * Update user profile attributes in Supabase.
 */
export async function updateUserProfile(
  userId: string,
  updates: Partial<UserProfile>
): Promise<AuthActionResult<UserProfile>> {
  try {
    const { isConfigured } = checkSupabaseConfig();
    if (!isConfigured) {
      return {
        data: null,
        error: new Error('Supabase is not configured yet.'),
      };
    }

    const { data, error } = await supabase
      .from('profiles')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      return { data: null, error: handleAuthError(error) };
    }

    return { data, error: null };
  } catch (err: unknown) {
    return { data: null, error: handleAuthError(err) };
  }
}

/**
 * Triggers a password reset email via Supabase Auth.
 */
export async function resetPasswordForEmail(email: string, redirectTo?: string): Promise<AuthActionResult<void>> {
  try {
    const { isConfigured } = checkSupabaseConfig();
    if (!isConfigured) {
      return {
        data: null,
        error: new Error('Supabase is not configured yet.'),
      };
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectTo || (typeof window !== 'undefined' ? `${window.location.origin}/login` : undefined),
    });

    if (error) {
      return { data: null, error: handleAuthError(error) };
    }

    return { data, error: null };
  } catch (err: unknown) {
    return { data: null, error: handleAuthError(err) };
  }
}
