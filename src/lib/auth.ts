import { supabase } from './supabase/client';
import type { User, Session } from '@supabase/supabase-js';

export interface UserProfile {
  id: string;
  username?: string | null;
  email?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  role: 'user' | 'admin' | 'moderator';
  is_admin: boolean;
  status: 'active' | 'suspended' | 'banned';
  btc_balance?: number;
  eth_balance?: number;
  usdt_balance?: number;
  ltc_balance?: number;
  last_active?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthActionResult<T = any> {
  data: T | null;
  error: Error | null;
}

/**
 * Sign in a user with email and password via Supabase Auth.
 */
export async function signInWithEmail(email: string, password: string): Promise<AuthActionResult<{ user: User | null; session: Session | null }>> {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data, error: null };
  } catch (err: unknown) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
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

    let targetEmail = trimmed;

    // If identifier is not an email (does not contain '@'), resolve via profiles table
    if (!trimmed.includes('@')) {
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
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: targetEmail.toLowerCase(),
      password,
    });

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data, error: null };
  } catch (err: unknown) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Sign up a new user with email, password, and metadata via Supabase Auth.
 */
export async function signUpWithEmail(
  email: string,
  password: string,
  metadata?: { username?: string; displayName?: string }
): Promise<AuthActionResult<{ user: User | null; session: Session | null }>> {
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: metadata?.username || email.split('@')[0],
          display_name: metadata?.displayName || metadata?.username || email.split('@')[0],
        },
      },
    });

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    // Ensure profile row exists in profiles table
    if (data.user) {
      await supabase.from('profiles').upsert({
        id: data.user.id,
        email: data.user.email,
        username: metadata?.username || email.split('@')[0],
        display_name: metadata?.displayName || metadata?.username || email.split('@')[0],
        role: 'user',
        is_admin: false,
        status: 'active',
        updated_at: new Date().toISOString(),
      });
    }

    return { data, error: null };
  } catch (err: unknown) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Sign out the currently authenticated user.
 */
export async function signOut(): Promise<AuthActionResult<void>> {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      return { data: null, error: new Error(error.message) };
    }
    return { data: null, error: null };
  } catch (err: unknown) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Get the currently authenticated user from Supabase.
 */
export async function getCurrentUser(): Promise<User | null> {
  try {
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
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return {
      id: data.id,
      username: data.username,
      email: data.email,
      display_name: data.display_name || data.username,
      avatar_url: data.avatar_url,
      role: data.role || (data.is_admin ? 'admin' : 'user'),
      is_admin: Boolean(data.is_admin || data.role === 'admin'),
      status: data.status || 'active',
      btc_balance: Number(data.btc_balance || 0),
      eth_balance: Number(data.eth_balance || 0),
      usdt_balance: Number(data.usdt_balance || 0),
      ltc_balance: Number(data.ltc_balance || 0),
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
      return { data: null, error: new Error(error.message) };
    }

    return { data, error: null };
  } catch (err: unknown) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Triggers a password reset email via Supabase Auth.
 */
export async function resetPasswordForEmail(email: string, redirectTo?: string): Promise<AuthActionResult<void>> {
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectTo || `${window.location.origin}/login`,
    });

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data: null, error: null };
  } catch (err: unknown) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}
