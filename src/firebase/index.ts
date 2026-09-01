'use client';

import React from 'react';

const FirebaseContext = React.createContext({
  user: null,
  firestore: null,
  auth: null,
  storage: null,
  loading: false,
});

export function useFirebase() {
  return React.useContext(FirebaseContext);
}

export function useCollection(query: any) {
  return { data: [], loading: false, error: null };
}

export function useDoc(ref: any) {
  return { data: null, loading: false, error: null };
}

export function useMemoFirebase<T>(factory: () => T, deps: any[]): T {
  return React.useMemo(factory, deps);
}

export function FirebaseProvider(props: { children: React.ReactNode }) {
  return React.createElement(
    FirebaseContext.Provider,
    { value: { user: null, firestore: null, auth: null, storage: null, loading: false } },
    props.children
  );
}
