'use client';

import { useEffect } from 'react';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

/**
 * An invisible component that listens for globally emitted 'permission-error' events.
 * It logs the error to the console instead of throwing it, to prevent app crashes
 * from intermittent, unrecoverable internal Firestore SDK errors.
 */
export function FirebaseErrorListener() {
  useEffect(() => {
    // The callback now expects a strongly-typed error, matching the event payload.
    const handleError = (error: FirestorePermissionError) => {
      console.error(
        "Firestore Permission Error Caught:",
        "This may be a legitimate security rule issue or an internal SDK error.",
        "The error is being logged here instead of thrown to prevent a full app crash.",
        error
      );
    };

    errorEmitter.on('permission-error', handleError);

    // Unsubscribe on unmount to prevent memory leaks.
    return () => {
      errorEmitter.off('permission-error', handleError);
    };
  }, []);

  // This component renders nothing and does not throw errors.
  return null;
}
