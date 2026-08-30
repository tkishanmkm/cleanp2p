'use client';
import { Firestore, collection, addDoc } from 'firebase/firestore';
import { SupportTicket } from './types';

export async function createSupportTicket(
  db: Firestore,
  ticketData: Omit<SupportTicket, 'id' | 'createdAt' | 'status'>
): Promise<void> {
  const ticketsCollection = collection(db, 'support_tickets');
  const newTicket: Omit<SupportTicket, 'id'> = {
    ...ticketData,
    status: 'Open',
    createdAt: new Date().toISOString(),
  };
  await addDoc(ticketsCollection, newTicket);
}
