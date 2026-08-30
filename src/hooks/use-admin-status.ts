'use client';
import { useState, useEffect } from 'react';
import { useFirebase } from '@/firebase';
import { doc, getDoc } from 'firebase/firestore';

export function useAdminStatus() {
  const { user, firestore, isUserLoading } = useFirebase();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true); // Always start in a loading state

  useEffect(() => {
    // We cannot determine admin status until Firebase has confirmed the user's auth state.
    if (isUserLoading) {
      // If auth is still loading, we stay in a loading state.
      setIsLoading(true);
      return;
    }

    // If auth is resolved and there is no user, they cannot be an admin.
    if (!user || !firestore) {
      setIsAdmin(false);
      setIsLoading(false); // We are no longer loading; we know the answer is "no".
      return;
    }

    // At this point, auth is resolved and we have a user.
    // We must now check their role in the database.
    const checkAdminStatus = async () => {
      const adminRoleRef = doc(firestore, 'admins', user.uid);
      try {
        const docSnap = await getDoc(adminRoleRef);
        // The user is an admin if the document exists AND the role is 'admin'.
        if (docSnap.exists() && docSnap.data().role === 'admin') {
            setIsAdmin(true);
        } else {
            setIsAdmin(false);
        }
      } catch (error) {
        // If the check fails for any reason (e.g., permissions, network),
        // default to not being an admin for security.
        console.error("Error checking admin status:", error);
        setIsAdmin(false);
      } finally {
        // The database check is complete, so we are no longer in a loading state.
        setIsLoading(false);
      }
    };

    checkAdminStatus();

  }, [user, isUserLoading, firestore]); // This effect re-runs whenever the user or loading state changes.

  return { isAdmin, isLoading };
}
