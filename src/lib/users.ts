'use client';
import { Firestore, doc, updateDoc, arrayUnion, arrayRemove, collection, query, where, getDocs, addDoc, writeBatch, limit, getDoc, setDoc } from 'firebase/firestore';
import type { User as AuthUser } from 'firebase/auth';
import { countries } from './countries';
import type { Trade } from './types';

/**
 * Blocks a target user by adding their UID to the current user's block list.
 * @param db - The Firestore instance.
 * @param currentUserId - The UID of the user performing the block.
 * @param targetUsername - The username of the user to block.
 */
export async function blockUser(db: Firestore, currentUserId: string, targetUsername: string) {
    // Find target user by username
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("userId", "==", targetUsername), limit(1));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
        throw new Error(`User "${targetUsername}" not found.`);
    }
    const targetUserDoc = querySnapshot.docs[0];
    const targetUserId = targetUserDoc.id;
    if (currentUserId === targetUserId) {
        throw new Error("You cannot block yourself.");
    }
    
    // Check for active trades
    const tradesRef = collection(db, "trades");
    const activeTradeQuery = query(tradesRef,
        where('status', 'in', ['active', 'paid', 'disputed'])
    );

    const activeTradesSnapshot = await getDocs(activeTradeQuery);
    const activeTradesBetweenUsers = activeTradesSnapshot.docs
        .map(d => ({ id: d.id, ...d.data() } as Trade))
        .filter(t =>
            (t.buyerId === currentUserId && t.sellerId === targetUserId) ||
            (t.buyerId === targetUserId && t.sellerId === currentUserId)
        );

    // Add system message if active trades exist
    if (activeTradesBetweenUsers.length > 0) {
        const currentUserDocSnap = await getDoc(doc(db, "users", currentUserId));
        const currentUsername = currentUserDocSnap.data()?.userId || 'The other user';
        const batch = writeBatch(db);

        for (const trade of activeTradesBetweenUsers) {
            const messagesColRef = collection(db, 'trades', trade.id, 'messages');
            const systemMessage = {
                tradeId: trade.id,
                senderId: 'system',
                senderUsername: 'System',
                message: `${currentUsername} has blocked you. This will not affect the current trade. Please continue with the transaction. Do not cancel the trade.`,
                isModerator: true,
                createdAt: new Date().toISOString(),
            };
            batch.set(doc(messagesColRef), systemMessage);
        }
        await batch.commit();
    }


    const currentUserRef = doc(db, "users", currentUserId);
    await updateDoc(currentUserRef, {
        blockedUsers: arrayUnion(targetUserId)
    });
}

/**
 * Unblocks a target user by removing their UID from the current user's block list.
 * @param db - The Firestore instance.
 * @param currentUserId - The UID of the user performing the unblock.
 * @param targetUserIdToUnblock - The UID of the user to unblock.
 */
export async function unblockUser(db: Firestore, currentUserId: string, targetUserIdToUnblock: string) {
  const currentUserRef = doc(db, "users", currentUserId);
  await updateDoc(currentUserRef, {
    blockedUsers: arrayRemove(targetUserIdToUnblock)
  });
}


/**
 * Creates a session document for a user and updates their IP-based country.
 * @param db - The Firestore instance.
 * @param user - The authenticated user object from Firebase Auth.
 * @returns The ID of the newly created session document.
 */
export async function createUserSession(db: Firestore, user: AuthUser): Promise<string | undefined> {
  if (!user) return;

  // 1. Create session document
  const sessionDocRef = doc(collection(db, "users", user.uid, "sessions"));
  const simulatedIp = `192.168.1.${Math.floor(Math.random() * 254) + 1}`;
  const sessionData = {
    userId: user.uid,
    userAgent: navigator.userAgent,
    ipAddress: simulatedIp,
    lastLogin: new Date().toISOString(),
    isActive: true,
  };
  await setDoc(sessionDocRef, sessionData);

  // 2. Update user's IP-based country using set with merge to avoid "No document to update" error
  const userDocRef = doc(db, "users", user.uid);
  const randomIpCountry = countries[Math.floor(Math.random() * countries.length)].code;
  
  await setDoc(userDocRef, { ipBasedCountry: randomIpCountry }, { merge: true });

  return sessionDocRef.id;
}


/**
 * Logs out specified sessions by marking them as inactive.
 * @param db The Firestore instance.
 * @param userId The UID of the user.
 * @param sessionIdsToLogout An array of session document IDs to log out.
 */
export async function logoutSessions(db: Firestore, userId: string, sessionIdsToLogout: string[]) {
  if (!userId || !sessionIdsToLogout || sessionIdsToLogout.length === 0) {
    throw new Error("User ID and session IDs are required.");
  }
  const sessionsRef = collection(db, "users", userId, "sessions");
  const batch = writeBatch(db);

  sessionIdsToLogout.forEach(sessionId => {
    const sessionRef = doc(sessionsRef, sessionId);
    batch.update(sessionRef, { isActive: false });
  });

  await batch.commit();
}
