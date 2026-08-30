
'use client';

import {
  Firestore,
  doc,
  runTransaction,
  writeBatch,
  updateDoc,
  collection,
  arrayRemove,
  setDoc,
  getDocs,
  query,
  where,
  limit,
  getDoc,
} from "firebase/firestore";
import type { CryptoCurrency, Deposit, Dispute, Trade, UserWallet, Withdrawal, SupportTicket, User as AppUser } from "./types";
import { cancelTrade, markTradeAsPaid, releaseFundsFromEscrow } from "./wallet";

/**
 * Approves a deposit and updates the user's aggregate wallet for that cryptocurrency.
 */
export async function approveDeposit(
  db: Firestore,
  deposit: Deposit,
  approvedAmount: number,
  adminId: string
): Promise<void> {
  const depositRef = doc(db, "deposits", deposit.id);
  const userRef = doc(db, "users", deposit.userId);
  const notificationRef = doc(collection(db, "users", deposit.userId, "notifications"));

  await runTransaction(db, async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists()) throw new Error("User profile not found.");
    
    const userData = userDoc.data() as AppUser;
    const currentWallet = userData.wallets?.[deposit.crypto] || { balance: 0, lockedBalance: 0 };

    const newBalance = (currentWallet.balance || 0) + approvedAmount;

    // Update the unified balance on the user document
    transaction.update(userRef, {
        [`wallets.${deposit.crypto}.balance`]: newBalance,
        [`wallets.${deposit.crypto}.lockedBalance`]: currentWallet.lockedBalance || 0,
    });

    // Mark the deposit as approved
    transaction.update(depositRef, {
      status: "approved",
      finalAmount: approvedAmount,
      adminId: adminId,
    });

    // Notify user
    transaction.set(notificationRef, {
        userId: deposit.userId,
        message: `Your deposit of ${approvedAmount} ${deposit.crypto} has been approved and added to your wallet.`,
        isRead: false,
        createdAt: new Date().toISOString(),
        link: `/wallets`
    });
  });
}

/**
 * Declines a deposit request.
 */
export async function declineDeposit(
  db: Firestore,
  deposit: Deposit,
  adminId: string,
): Promise<void> {
  const depositRef = doc(db, "deposits", deposit.id);
  await updateDoc(depositRef, {
      status: "declined",
      adminId: adminId,
  });
}

/**
 * Approves a withdrawal request. This finalizes the withdrawal.
 */
export async function approveWithdrawal(
  db: Firestore,
  withdrawal: Withdrawal,
  adminId: string
): Promise<void> {
  const withdrawalRef = doc(db, "users", withdrawal.userId, "withdrawals", withdrawal.id);
  const userRef = doc(db, "users", withdrawal.userId);
  const notificationRef = doc(collection(db, "users", withdrawal.userId, "notifications"));

  await runTransaction(db, async (transaction) => {
    const withdrawalDoc = await transaction.get(withdrawalRef);
    if (!withdrawalDoc.exists() || withdrawalDoc.data().status !== 'pending') {
      throw new Error("Withdrawal is not pending or does not exist.");
    }
    
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists()) throw new Error("User profile not found.");
    
    const userData = userDoc.data() as AppUser;
    const currentWallet = userData.wallets?.[withdrawal.crypto];

    if (!currentWallet || (currentWallet.lockedBalance || 0) < withdrawal.amount) {
      throw new Error("Insufficient locked balance. Critical error.");
    }

    // Deduct from locked balance on user document
    transaction.update(userRef, {
      [`wallets.${withdrawal.crypto}.lockedBalance`]: (currentWallet.lockedBalance || 0) - withdrawal.amount,
    });

    // Mark withdrawal as approved
    transaction.update(withdrawalRef, {
      status: "approved",
      adminId: adminId,
    });

     // Notify user
    transaction.set(notificationRef, {
        userId: withdrawal.userId,
        message: `Your withdrawal of ${withdrawal.amount} ${withdrawal.crypto} has been approved and processed.`,
        isRead: false,
        createdAt: new Date().toISOString(),
        link: `/wallets`
    });
  });
}

/**
 * Declines a withdrawal request and returns funds to the user's aggregate available balance.
 */
export async function declineWithdrawal(
  db: Firestore,
  withdrawal: Withdrawal,
  adminId: string
): Promise<void> {
    const withdrawalRef = doc(db, "users", withdrawal.userId, "withdrawals", withdrawal.id);
    const userRef = doc(db, "users", withdrawal.userId);
    const notificationRef = doc(collection(db, "users", withdrawal.userId, "notifications"));

    await runTransaction(db, async (transaction) => {
        const withdrawalDoc = await transaction.get(withdrawalRef);
        if (!withdrawalDoc.exists() || withdrawalDoc.data().status !== 'pending') {
            throw new Error("Withdrawal is not pending or does not exist.");
        }

        const userDoc = await transaction.get(userRef);
        if (!userDoc.exists()) throw new Error("User profile not found.");
        
        const userData = userDoc.data() as AppUser;
        const currentWallet = userData.wallets?.[withdrawal.crypto] || { balance: 0, lockedBalance: 0 };

        // Return funds from locked to available balance on user document
        transaction.update(userRef, {
            [`wallets.${withdrawal.crypto}.balance`]: (currentWallet.balance || 0) + withdrawal.amount,
            [`wallets.${withdrawal.crypto}.lockedBalance`]: Math.max(0, (currentWallet.lockedBalance || 0) - withdrawal.amount),
        });

        // Mark withdrawal as declined
        transaction.update(withdrawalRef, {
            status: "declined",
            adminId: adminId,
        });

        // Notify user
        transaction.set(notificationRef, {
            userId: withdrawal.userId,
            message: `Your withdrawal of ${withdrawal.amount} ${withdrawal.crypto} was declined and the funds returned to your wallet.`,
            isRead: false,
            createdAt: new Date().toISOString(),
            link: `/wallets`
        });
    });
}

export async function setUserBanStatus(db: Firestore, userId: string, userDisplayName: string, isBanned: boolean, adminId: string, reason: string) {
  const userRef = doc(db, "users", userId);
  const adminLogRef = doc(collection(db, "admin_logs"));
  const notificationRef = doc(collection(db, "users", userId, "notifications"));

  const batch = writeBatch(db);

  batch.update(userRef, { isBanned });

  const actionMessage = isBanned ? `Banned user ${userDisplayName}. Reason: ${reason}` : `Unbanned user ${userDisplayName}. Reason: ${reason}`;
  batch.set(adminLogRef, {
    adminId,
    action: actionMessage,
    targetId: userId,
    createdAt: new Date().toISOString(),
  });

  const notificationMessage = isBanned ? `Your account has been banned. Reason: ${reason}` : `The ban on your account has been lifted. Reason: ${reason}`;
  batch.set(notificationRef, {
    userId,
    message: notificationMessage,
    isRead: false,
    createdAt: new Date().toISOString(),
  });

  await batch.commit();
}

export async function setUserHoldStatus(db: Firestore, userId: string, userDisplayName: string, isOnHold: boolean, adminId: string, reason: string) {
  const userRef = doc(db, "users", userId);
  const adminLogRef = doc(collection(db, "admin_logs"));
  const notificationRef = doc(collection(db, "users", userId, "notifications"));

  const batch = writeBatch(db);

  batch.update(userRef, { isOnHold });

  const actionMessage = isOnHold ? `Placed account of ${userDisplayName} on hold. Reason: ${reason}` : `Removed hold on account of ${userDisplayName}. Reason: ${reason}`;
  batch.set(adminLogRef, {
    adminId,
    action: actionMessage,
    targetId: userId,
    createdAt: new Date().toISOString(),
  });

  const notificationMessage = isOnHold ? `Your account has been placed on hold. Reason: ${reason}` : `The hold on your account has been removed. Reason: ${reason}`;
  batch.set(notificationRef, {
    userId,
    message: notificationMessage,
    isRead: false,
    createdAt: new Date().toISOString(),
  });

  await batch.commit();
}

export async function resolveDispute(
  db: Firestore, 
  trade: Trade, 
  dispute: Dispute, 
  winnerId: string, 
  adminId: string,
  fiatAmountInUSD: number
) {
  const tradeRef = doc(db, "trades", trade.id);
  const disputeRef = doc(db, "trades", trade.id, "disputes", dispute.id);
  const messagesCollectionRef = collection(db, 'trades', trade.id, 'messages');

  return runTransaction(db, async (transaction) => {
    const sellerUserRef = doc(db, 'users', trade.sellerId);
    const buyerUserRef = doc(db, 'users', trade.buyerId);
    
    const [sellerDoc, buyerDoc] = await Promise.all([
        transaction.get(sellerUserRef),
        transaction.get(buyerUserRef),
    ]);

    if (!sellerDoc.exists()) throw new Error("Seller profile not found.");
    if (!buyerDoc.exists()) throw new Error("Buyer profile not found.");

    const sellerData = sellerDoc.data() as AppUser;
    const buyerData = buyerDoc.data() as AppUser;

    const winnerUsername = winnerId === trade.buyerId ? trade.buyer.username : trade.seller.username;
    let finalTradeStatus: 'cancelled' | 'released';
    let systemMessageText: string;

    if (winnerId === trade.sellerId) {
      // SELLER wins: Cancel trade and return funds to their available balance
      finalTradeStatus = 'cancelled';
      const sellerWallet = sellerData.wallets?.[trade.crypto] || { balance: 0, lockedBalance: 0 };
      
      if ((sellerWallet.lockedBalance || 0) < trade.amount) throw new Error("Insufficient locked funds to return.");
      
      transaction.update(sellerUserRef, {
        [`wallets.${trade.crypto}.balance`]: (sellerWallet.balance || 0) + trade.amount,
        [`wallets.${trade.crypto}.lockedBalance`]: (sellerWallet.lockedBalance || 0) - trade.amount,
      });
      transaction.update(tradeRef, { status: finalTradeStatus });
      systemMessageText = `Dispute resolved. The trade has been awarded to the seller (${winnerUsername}) and is now cancelled. Funds returned to seller.`;

    } else { // BUYER wins: Release funds to them
      finalTradeStatus = 'released';
      
      const sellerWallet = sellerData.wallets?.[trade.crypto] || { balance: 0, lockedBalance: 0 };
      const buyerWallet = buyerData.wallets?.[trade.crypto] || { balance: 0, lockedBalance: 0 };

      // 1. Decrement seller's locked balance
      if ((sellerWallet.lockedBalance || 0) < trade.amount) throw new Error("Insufficient locked funds to release.");
      transaction.update(sellerUserRef, {
        [`wallets.${trade.crypto}.lockedBalance`]: (sellerWallet.lockedBalance || 0) - trade.amount,
        completedTrades: (sellerData.completedTrades || 0) + 1,
        tradeVolume: (sellerData.tradeVolume || 0) + fiatAmountInUSD,
        lastTradeAt: new Date().toISOString(),
      });
      
      // 2. Calculate fees and credit buyer
      const fee = trade.escrowFee || (trade.amount * 0.01);
      const amountToBuyer = trade.amount - fee;
      
      transaction.update(buyerUserRef, {
        [`wallets.${trade.crypto}.balance`]: (buyerWallet.balance || 0) + amountToBuyer,
        completedTrades: (buyerData.completedTrades || 0) + 1,
        tradeVolume: (buyerData.tradeVolume || 0) + fiatAmountInUSD,
        lastTradeAt: new Date().toISOString(),
      });

      // 3. Log escrow fee
      const ledgerRef = doc(collection(db, "escrow_ledger"));
      transaction.set(ledgerRef, {
          tradeId: trade.tradeId,
          feeAmount: fee,
          crypto: trade.crypto,
          createdAt: new Date().toISOString()
      });

      // 4. Update trade status
      transaction.update(tradeRef, { 
          status: finalTradeStatus, 
          releasedAt: new Date().toISOString(),
          claimedByBuyer: true,
          fiatAmountInUSD: fiatAmountInUSD,
      });

      systemMessageText = `Dispute resolved. The trade has been awarded to the buyer (${winnerUsername}) and is now completed. Funds released to buyer.`;
    }

    // Update dispute doc
    transaction.update(disputeRef, {
      status: "resolved",
      winnerId: winnerId,
      resolvedBy: adminId,
      resolutionNote: `Dispute awarded to ${winnerUsername} by moderator.`,
    });

    // Add system message
    transaction.set(doc(messagesCollectionRef), {
      tradeId: trade.id,
      senderId: 'system',
      senderUsername: 'System',
      message: systemMessageText,
      isModerator: true,
      createdAt: new Date().toISOString(),
    });

    // Add notifications
    const winnerNotifRef = doc(collection(db, 'users', winnerId, 'notifications'));
    transaction.set(winnerNotifRef, {
        userId: winnerId,
        message: `You have won the dispute for trade ${trade.tradeId}.`,
        link: `/trade/${trade.id}`,
        isRead: false,
        createdAt: new Date().toISOString(),
    });

    const opponentId = winnerId === trade.buyerId ? trade.sellerId : trade.buyerId;
    const loserNotifRef = doc(collection(db, 'users', opponentId, 'notifications'));
    transaction.set(loserNotifRef, {
        userId: opponentId,
        message: `The dispute for trade ${trade.tradeId} has been resolved in favor of the other party.`,
        link: `/trade/${trade.id}`,
        isRead: false,
        createdAt: new Date().toISOString(),
    });
  });
}

export async function updateSupportTicketStatus(db: Firestore, ticketId: string, status: SupportTicket['status'], note?: string) {
  const ticketRef = doc(db, "support_tickets", ticketId);
  const updateData: { status: SupportTicket['status'], resolutionNote?: string } = { status };
  if (note) {
    updateData.resolutionNote = note;
  }
  await updateDoc(ticketRef, updateData);
}

/**
 * Manually adjusts a user's wallet balance.
 */
export async function adjustUserWalletBalance(
  db: Firestore,
  adminId: string,
  userId: string,
  userDisplayName: string,
  crypto: CryptoCurrency,
  action: 'add' | 'subtract',
  amount: number,
  reason: string
): Promise<void> {
  if (amount <= 0) {
    throw new Error("Amount must be a positive number.");
  }
  
  const userRef = doc(db, "users", userId);
  const adminLogRef = doc(collection(db, "admin_logs"));
  const notificationRef = doc(collection(db, "users", userId, "notifications"));

  await runTransaction(db, async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists()) throw new Error("User profile not found.");
    
    const userData = userDoc.data() as AppUser;
    const currentWallet = userData.wallets?.[crypto] || { balance: 0, lockedBalance: 0 };

    let newBalance: number;
    if (action === 'add') {
      newBalance = (currentWallet.balance || 0) + amount;
    } else { // subtract
      newBalance = (currentWallet.balance || 0) - amount;
      if (newBalance < 0) {
        throw new Error("Cannot subtract more than the available balance.");
      }
    }

    // Update the unified balance on the user document
    transaction.update(userRef, {
      [`wallets.${crypto}.balance`]: newBalance,
      [`wallets.${crypto}.lockedBalance`]: currentWallet.lockedBalance || 0,
    });

    // Create log
    transaction.set(adminLogRef, {
      adminId: adminId,
      action: `Adjusted ${userDisplayName}'s ${crypto} balance. Action: ${action}, Amount: ${amount}. Reason: ${reason}`,
      targetId: userId,
      createdAt: new Date().toISOString(),
    });

     // Create user notification
    transaction.set(notificationRef, {
        userId,
        message: `An admin has adjusted your ${crypto} wallet balance. Action: ${action}, Amount: ${amount}. Reason: ${reason}`,
        isRead: false,
        createdAt: new Date().toISOString(),
        link: '/wallets'
    });
  });
}

/**
 * Allows an administrator to remove a user from another user's block list.
 */
export async function adminUnblockUser(
  db: Firestore,
  ownerUserId: string,
  targetUserIdToUnblock: string
): Promise<void> {
  const userRef = doc(db, "users", ownerUserId);
  await updateDoc(userRef, {
    blockedUsers: arrayRemove(targetUserIdToUnblock)
  });
}

export async function adminCancelTrade(db: Firestore, trade: Trade, adminId: string, reason: string) {
    const fullReason = `Cancelled by administrator. Reason: ${reason}`;
    await cancelTrade(db, trade, fullReason);
    const adminLogRef = doc(collection(db, "admin_logs"));
    await setDoc(adminLogRef, {
        adminId,
        action: `Admin cancelled trade ${trade.tradeId}. Reason: ${reason}`,
        targetId: trade.id,
        createdAt: new Date().toISOString(),
    });
}

export async function adminMarkTradeAsPaid(db: Firestore, trade: Trade, adminId: string, reason: string) {
    await markTradeAsPaid(db, trade.id);
    const adminLogRef = doc(collection(db, "admin_logs"));
    await setDoc(adminLogRef, {
        adminId,
        action: `Admin marked trade ${trade.tradeId} as paid. Reason: ${reason}`,
        targetId: trade.id,
        createdAt: new Date().toISOString(),
    });
}

export async function adminReleaseFunds(db: Firestore, trade: Trade, adminId: string, reason: string) {
    await releaseFundsFromEscrow(db, trade.id);

    const adminLogRef = doc(collection(db, "admin_logs"));
    const messagesCollectionRef = collection(db, 'trades', trade.id, 'messages');
    const batch = writeBatch(db);

    batch.set(adminLogRef, {
        adminId,
        action: `Admin released funds for trade ${trade.tradeId}. Reason: ${reason}`,
        targetId: trade.id,
        createdAt: new Date().toISOString(),
    });

    const systemMessage = {
        tradeId: trade.id,
        senderId: 'system',
        senderUsername: 'System',
        message: `A moderator has released the crypto. The trade is now complete. Reason: ${reason}\nYou can now leave feedback for your partner.`,
        isModerator: true,
        createdAt: new Date().toISOString(),
    };
    batch.set(doc(messagesCollectionRef), systemMessage);

    await batch.commit();
}
