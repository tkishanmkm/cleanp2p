'use client';
import { useAuth } from '@/components/providers/auth-provider';

export function useAdminStatus() {
  const { isAdmin, isLoading } = useAuth();
  return { isAdmin, isLoading };
}
