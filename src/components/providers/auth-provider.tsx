'use client';

import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import type { User as SupabaseUser, Session } from '@supabase/supabase-js';
import { supabase, checkSupabaseConfig } from '@/lib/supabase/client';
import {
  getUserProfile,
  signInWithEmail,
  signInWithIdentifier,
  signUpWithEmail,
  signOut as authSignOut,
  type UserProfile,
} from '@/lib/auth';

export interface AuthUser {
  uid: string;
  id: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role: 'user' | 'admin' | 'moderator';
  isAdmin: boolean;
  rawUser: SupabaseUser;
}

export interface AuthContextState {
  user: AuthUser | null;
  supabaseUser: SupabaseUser | null;
  profile: UserProfile | null;
  session: Session | null;
  isAdmin: boolean;
  isLoading: boolean;
  isUserLoading: boolean;
  userError: Error | null;
  signIn: typeof signInWithEmail;
  signUp: typeof signUpWithEmail;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [userError, setUserError] = useState<Error | null>(null);

  const fetchProfile = async (uid: string) => {
    try {
      const p = await getUserProfile(uid);
      setProfile(p);
      return p;
    } catch (err) {
      console.error('Failed to fetch user profile:', err);
      return null;
    }
  };

  useEffect(() => {
    let mounted = true;

    // Safety timeout: Never allow loading state to freeze longer than 3 seconds
    const fallbackTimer = setTimeout(() => {
      if (mounted) {
        setIsLoading(false);
      }
    }, 3000);

    // 1. Initial session retrieval
    const initializeAuth = async () => {
      const { isConfigured } = checkSupabaseConfig();
      if (!isConfigured) {
        if (mounted) {
          setIsLoading(false);
        }
        return;
      }

      try {
        const { data, error } = await supabase.auth.getSession();
        if (!mounted) return;

        if (error) {
          console.warn('Supabase getSession returned error:', error);
          setUserError(new Error(error.message));
          setSession(null);
          setSupabaseUser(null);
          setProfile(null);
        } else {
          const currentSession = data.session;
          setSession(currentSession);
          const currentUser = currentSession?.user ?? null;
          setSupabaseUser(currentUser);

          if (currentUser) {
            try {
              await fetchProfile(currentUser.id);
            } catch (err) {
              console.warn('Profile fetch error during init:', err);
            }
          } else {
            setProfile(null);
          }
        }
      } catch (err) {
        if (mounted) {
          console.error('Unhandled exception in initializeAuth:', err);
          setUserError(err instanceof Error ? err : new Error(String(err)));
          setSession(null);
          setSupabaseUser(null);
          setProfile(null);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    initializeAuth();

    // 2. Real-time auth state listener
    let authListener: { subscription: { unsubscribe: () => void } } | null = null;
    try {
      const { data } = supabase.auth.onAuthStateChange(async (event, newSession) => {
        if (!mounted) return;
        try {
          setSession(newSession);
          const newUser = newSession?.user ?? null;
          setSupabaseUser(newUser);

          if (newUser) {
            try {
              await fetchProfile(newUser.id);
            } catch (pErr) {
              console.warn('Profile fetch error on auth state change:', pErr);
            }
          } else {
            setProfile(null);
          }
        } catch (eventErr) {
          console.error('Error in onAuthStateChange handler:', eventErr);
        } finally {
          if (mounted) {
            setIsLoading(false);
          }
        }
      });
      authListener = data;
    } catch (listenerErr) {
      console.error('Failed to register auth state listener:', listenerErr);
      if (mounted) {
        setIsLoading(false);
      }
    }

    return () => {
      mounted = false;
      clearTimeout(fallbackTimer);
      if (authListener?.subscription) {
        authListener.subscription.unsubscribe();
      }
    };
  }, []);

  const refreshProfile = async () => {
    if (supabaseUser) {
      await fetchProfile(supabaseUser.id);
    }
  };

  const handleSignOut = async () => {
    await authSignOut();
    setSession(null);
    setSupabaseUser(null);
    setProfile(null);
  };

  // Map user to normalized structure compatible with both standard and legacy consumers
  const authUser: AuthUser | null = useMemo(() => {
    if (!supabaseUser) return null;
    const isUserAdmin = Boolean(
      profile?.is_admin ||
      profile?.role === 'admin' ||
      supabaseUser.user_metadata?.role === 'admin' ||
      supabaseUser.app_metadata?.role === 'admin'
    );

    return {
      uid: supabaseUser.id,
      id: supabaseUser.id,
      email: supabaseUser.email || null,
      displayName: profile?.display_name || profile?.username || supabaseUser.user_metadata?.display_name || supabaseUser.user_metadata?.username || (supabaseUser.email ? supabaseUser.email.split('@')[0] : 'User'),
      photoURL: profile?.avatar_url || supabaseUser.user_metadata?.avatar_url || null,
      role: (profile?.role || (isUserAdmin ? 'admin' : 'user')) as 'user' | 'admin' | 'moderator',
      isAdmin: isUserAdmin,
      rawUser: supabaseUser,
    };
  }, [supabaseUser, profile]);

  const isAdmin = Boolean(authUser?.isAdmin);

  const value = useMemo<AuthContextState>(() => ({
    user: authUser,
    supabaseUser,
    profile,
    session,
    isAdmin,
    isLoading,
    isUserLoading: isLoading,
    userError,
    signIn: signInWithIdentifier,
    signUp: signUpWithEmail,
    signOut: handleSignOut,
    refreshProfile,
  }), [authUser, supabaseUser, profile, session, isAdmin, isLoading, userError]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function useUser() {
  const { user, isUserLoading, userError } = useAuth();
  return { user, isUserLoading, userError };
}
