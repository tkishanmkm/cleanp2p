
import admin from 'firebase-admin';

// This ensures we only initialize the app once.
if (!admin.apps.length) {
  try {
    const serviceAccount = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    };

    // Check if all required environment variables are present before initializing.
    if (!serviceAccount.projectId || !serviceAccount.privateKey || !serviceAccount.clientEmail) {
      console.warn('Firebase Admin SDK configuration is missing. Server-side features like withdrawals will not work. Please set FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, and FIREBASE_CLIENT_EMAIL environment variables.');
    } else {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }
  } catch (error) {
    console.error('Firebase Admin SDK initialization error:', error);
  }
}

// We export the services even if initialization failed, but they might not work.
// The app should handle cases where these services are not available.
export const firestoreAdmin = admin.apps.length ? admin.firestore() : {} as admin.firestore.Firestore;
export const authAdmin = admin.apps.length ? admin.auth() : {} as admin.auth.Auth;
