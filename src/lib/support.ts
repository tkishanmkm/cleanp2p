'use client';
import { SupportTicket } from './types';
import { supabase } from '@/lib/supabase/client';

export async function createSupportTicket(
  _db: any,
  ticketData: Omit<SupportTicket, 'id' | 'createdAt' | 'status'>
): Promise<void> {
  const newTicket = {
    ...ticketData,
    status: 'Open',
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('support_tickets').insert([newTicket]);
  if (error) {
    throw new Error(error.message);
  }
}
