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
  is_2fa_enabled?: boolean;
  is_mfa_enabled?: boolean;
  two_factor_enabled?: boolean;
  has_2fa?: boolean;
  two_factor_secret?: string | null;
  is_banned?: boolean;
  is_restricted?: boolean;
  account_status?: string;
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

const PREFIXES = [
  'force', 'speed', 'energy', 'power', 'swift', 'quick', 'hyper', 'cyber', 
  'apex', 'turbo', 'shadow', 'smart', 'vortex', 'crypto', 'prime', 'bold', 
  'flash', 'star', 'alpha', 'delta', 'pulse', 'ultra', 'solid', 'storm', 
  'fire', 'iron', 'titan', 'bright', 'zenith', 'vector'
];

const ROOTS = [
  'call', 'hui', 'man', 'core', 'wave', 'link', 'node', 'hub', 'flow', 
  'run', 'dex', 'fox', 'bot', 'trader', 'vault', 'zone', 'byte', 'hawk', 
  'ray', 'peak', 'grid', 'pulse', 'flex', 'nest', 'spark', 'sync'
];

const SEPARATORS = ['', '', '', '', '_', '.'];

/**
 * Generates an auto-generated profile username between 5 and 25 characters.
 * Uses lowercase alphabets, numbers, '.', and '_'.
 * Examples: forcecall33, speedhui66, energyman6338, swiftnode.92, cyber_wave77
 */
export function generateUniqueUsername(): string {
  const prefix = PREFIXES[Math.floor(Math.random() * PREFIXES.length)];
  const root = ROOTS[Math.floor(Math.random() * ROOTS.length)];
  const sep = SEPARATORS[Math.floor(Math.random() * SEPARATORS.length)];
  
  // 2 to 4 digit number
  const randType = Math.random();
  let numStr = '';
  if (randType < 0.4) {
    numStr = String(Math.floor(10 + Math.random() * 90)); // 2 digits (e.g. 33, 66)
  } else if (randType < 0.7) {
    numStr = String(Math.floor(100 + Math.random() * 900)); // 3 digits
  } else {
    numStr = String(Math.floor(1000 + Math.random() * 9000)); // 4 digits (e.g. 6338)
  }

  let username = `${prefix}${root}${sep}${numStr}`.toLowerCase();
  
  // Ensure strictly 5 to 25 characters
  if (username.length > 25) {
    username = username.substring(0, 25);
  }
  if (username.length < 5) {
    username = `${username}99`;
  }
  
  return username;
}

export interface SignUpMetadata {
  username?: string;
  displayName?: string;
  fullName?: string;
  full_name?: string;
  dob?: string;
  country?: string;
  securityQuestion?: string;
  security_question?: string;
  securityAnswer?: string;
  security_answer?: string;
}

/**
 * Handle signup with formatted options.data for database trigger
 */
export async function handleSignUp(formData: {
  fullName: string;
  email: string;
  password: string;
  day: string;
  month: string;
  year: string;
  country: string;
  securityQuestion: string;
  securityAnswer: string;
}) {
  const monthMap: Record<string, string> = {
    January: '01', February: '02', March: '03', April: '04',
    May: '05', June: '06', July: '07', August: '08',
    September: '09', October: '10', November: '11', December: '12',
    '1': '01', '2': '02', '3': '03', '4': '04', '5': '05', '6': '06',
    '7': '07', '8': '08', '9': '09', '10': '10', '11': '11', '12': '12',
    '01': '01', '02': '02', '03': '03', '04': '04', '05': '05', '06': '06',
    '07': '07', '08': '08', '09': '09',
  };

  const formattedDay = String(formData.day || '1').padStart(2, '0');
  const formattedMonth = monthMap[formData.month] || String(formData.month || '1').padStart(2, '0');
  const formattedDob = `${formData.year}-${formattedMonth}-${formattedDay}`;

  const generatedUsername = generateUniqueUsername();

  const { data, error } = await supabase.auth.signUp({
    email: formData.email.trim().toLowerCase(),
    password: formData.password,
    options: {
      data: {
        full_name: formData.fullName.trim(),
        name: formData.fullName.trim(),
        username: generatedUsername,
        display_name: generatedUsername, // Profile username is display name
        dob: formattedDob,
        date_of_birth: formattedDob,
        country: formData.country,
        security_question: formData.securityQuestion,
        security_answer: formData.securityAnswer,
      },
    },
  });

  if (error) {
    console.error('Signup error:', error.message);
    return { success: false, message: error.message, error };
  }

  // Update profile with full_name and auto-generated username as display name
  if (data.user) {
    try {
      await supabase.from('profiles').upsert({
        id: data.user.id,
        email: data.user.email,
        full_name: formData.fullName.trim(),
        name: formData.fullName.trim(),
        username: generatedUsername,
        display_name: generatedUsername, // Profile username is display name
        dob: formattedDob,
        date_of_birth: formattedDob,
        security_question: formData.securityQuestion,
        security_answer: formData.securityAnswer,
        country: formData.country,
        updated_at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('Profile save note:', e);
    }
  }

  return { success: true, user: data.user, session: data.session, username: generatedUsername };
}

/**
 * Sign up a new user with email, password, and metadata via Supabase Auth.
 */
export async function signUpWithEmail(
  email: string,
  password: string,
  metadata?: SignUpMetadata
): Promise<AuthActionResult<{ user: User | null; session: Session | null; assignedUsername: string; rawError?: any }>> {
  try {
    const { isConfigured } = checkSupabaseConfig();
    if (!isConfigured) {
      return {
        data: null,
        error: new Error('Supabase is not configured yet. Please configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Settings.'),
      };
    }

    // Automatically generate a unique 5-25 char username if not provided
    const resolvedUsername = metadata?.username ? sanitizeUsername(metadata.username) : generateUniqueUsername();
    // Profile username is display name
    const resolvedDisplayName = resolvedUsername;
    const resolvedFullName = metadata?.fullName || metadata?.full_name || '';

    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: {
          full_name: resolvedFullName,
          name: resolvedFullName,
          display_name: resolvedDisplayName,
          username: resolvedUsername,
          dob: metadata?.dob,
          date_of_birth: metadata?.dob,
          country: metadata?.country,
          security_question: metadata?.securityQuestion || metadata?.security_question,
          security_answer: metadata?.securityAnswer || metadata?.security_answer,
        },
      },
    });

    if (error) {
      return { data: null, error: handleAuthError(error) };
    }

    // Ensure profile row exists in profiles table with username and full_name
    if (data.user) {
      try {
        await supabase.from('profiles').upsert({
          id: data.user.id,
          email: data.user.email,
          username: resolvedUsername,
          display_name: resolvedDisplayName,
          full_name: resolvedFullName,
          name: resolvedFullName,
          dob: metadata?.dob,
          date_of_birth: metadata?.dob,
          security_question: metadata?.securityQuestion || metadata?.security_question,
          security_answer: metadata?.securityAnswer || metadata?.security_answer,
          country: metadata?.country,
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
 * Direct User Signup helper with explicit username normalization.
 */
export async function handleUserSignup(email: string, pass: string, desiredUsername: string) {
  const cleanUsername = desiredUsername.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');

  if (cleanUsername.length < 3) {
    throw new Error('Username must be at least 3 characters long and alphanumeric.');
  }

  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password: pass,
    options: {
      data: {
        username: cleanUsername,
        full_name: cleanUsername,
      },
    },
  });

  if (error) throw error;
  return data;
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

    const is2fa = Boolean(
      data.is_2fa_enabled === true ||
      data.is_2fa_enabled === 'true' ||
      data.is_mfa_enabled === true ||
      data.is_mfa_enabled === 'true' ||
      data.two_factor_enabled === true ||
      Boolean(data.two_factor_secret && String(data.two_factor_secret).trim().length > 0)
    );

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
      is_2fa_enabled: is2fa,
      is_mfa_enabled: is2fa,
      two_factor_enabled: is2fa,
      has_2fa: is2fa,
      two_factor_secret: data.two_factor_secret || null,
      is_banned: Boolean(data.is_banned),
      is_restricted: Boolean(data.is_restricted),
      account_status: data.account_status || data.status || 'active',
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
