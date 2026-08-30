
'use client';
import {
  Firestore,
  doc,
  runTransaction,
  collection,
  addDoc,
  getDoc,
  writeBatch,
} from 'firebase/firestore';
import type { Trade, Dispute } from './types';

export async function openDispute(
  db: Firestore,
  trade: Trade,
  openerId: string,
  openerUsername: string,
  reason: string,
  explanation: string
): Promise<void> {
  const tradeRef = doc(db, 'trades', trade.id);
  const disputeCollectionRef = collection(db, 'trades', trade.id, 'disputes');
  const messagesCollectionRef = collection(db, 'trades', trade.id, 'messages');

  const batch = writeBatch(db);

  const tradeDoc = await getDoc(tradeRef);
  const currentTradeData = tradeDoc.data() as Trade;
  
  if (currentTradeData.status === 'disputed') {
    throw new Error('A dispute is already open for this trade.');
  }
  if (currentTradeData.status !== 'paid' && currentTradeData.status !== 'active') {
    throw new Error('Disputes can only be opened on active or paid trades.');
  }

  // 1. Update the trade status to 'disputed'
  batch.update(tradeRef, { status: 'disputed' });

  // 2. Create the new dispute document
  const newDispute: Omit<Dispute, 'id' | 'createdAt'> = {
    tradeId: trade.id,
    openedBy: openerId,
    reason: reason,
    explanation: explanation,
    status: 'open',
  };
  batch.set(doc(disputeCollectionRef), { ...newDispute, createdAt: new Date().toISOString() });

  // 3. Add a system message to the chat
  const systemMessage = {
    tradeId: trade.id,
    senderId: 'system',
    senderUsername: 'System',
    message: `This trade has been marked as disputed. Please do not release any crypto or make any further payment until the moderator reviews the case. A Paxones moderator will join the chat shortly to investigate and provide instructions. Kindly cooperate and share any required proof or details in the chat.\n\nReason from ${openerUsername}: ${reason}\n${explanation}`,
    isModerator: true, // Use this flag to style it as a system/moderator message
    createdAt: new Date().toISOString(),
  };
  batch.set(doc(messagesCollectionRef), systemMessage);
  
  // 4. Create notifications for both users
  const opponentId = openerId === trade.buyerId ? trade.sellerId : trade.buyerId;
  const opponentUsername = openerId === trade.buyerId ? trade.seller.userId : trade.buyer.userId;

  const openerNotificationRef = doc(collection(db, 'users', openerId, 'notifications'));
  batch.set(openerNotificationRef, {
      userId: openerId,
      message: `You have successfully opened a dispute for trade ${trade.tradeId}.`,
      link: `/trade/${trade.id}`,
      isRead: false,
      createdAt: new Date().toISOString(),
  });

  const opponentNotificationRef = doc(collection(db, 'users', opponentId, 'notifications'));
  batch.set(opponentNotificationRef, {
      userId: opponentId,
      message: `${openerUsername} has opened a dispute on trade ${trade.tradeId}. A moderator will join shortly.`,
      link: `/trade/${trade.id}`,
      isRead: false,
      createdAt: new Date().toISOString(),
  });
  
  await batch.commit();
}
