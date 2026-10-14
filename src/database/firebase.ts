// src/database/firebase.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

export function initializeFirestoreDb(projectId: string, clientEmail: string, privateKey: string): Firestore {
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing Firebase credentials for initialization');
  }

  const app = initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  }, 'firestore-' + new Date().getTime()); 

  return getFirestore(app);
}
