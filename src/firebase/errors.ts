export class FirestorePermissionError extends Error {
  constructor(message?: string) {
    super(message || 'Firestore Permission Denied');
    this.name = 'FirestorePermissionError';
  }
}
