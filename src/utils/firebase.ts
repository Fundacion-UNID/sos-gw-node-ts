// src/utils/firebase.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { getApps, initializeApp } from 'firebase-admin/app';

let isFirebaseInitialized = false;

function resolveFirebaseProjectIdFromEnv(): string | undefined {
  const projectId = String(
    process.env.FIREBASE_PROJECT_ID
    || process.env.FIRESTORE_PROJECT_ID
    || process.env.GOOGLE_CLOUD_PROJECT
    || process.env.GCLOUD_PROJECT
    || '',
  ).trim();
  return projectId || undefined;
}

/**
 * Initializes the primary Firebase Admin/data project if it is not initialized.
 * Additional token issuers use named Auth-only apps in FirebaseTokenVerifier;
 * they never replace this default app or select Firestore/GCS storage.
 * This function is idempotent and safe to call multiple times.
 */
export function initializeFirebase(): void {
  if (isFirebaseInitialized) {
    return;
  }

  try {
    if (getApps().length) {
      isFirebaseInitialized = true;
      console.log('[FirebaseUtil] Firebase Admin SDK was already initialized.');
      return;
    }
    const projectId = resolveFirebaseProjectIdFromEnv();
    initializeApp(projectId ? { projectId } : undefined);
    isFirebaseInitialized = true;
    console.log('[FirebaseUtil] Firebase Admin SDK initialized successfully.');
  } catch (error: any) {
    // Firebase throws an error if you try to initialize an app that already exists.
    // We can safely ignore this specific error.
    if (error.code === 'app/duplicate-app') {
      isFirebaseInitialized = true;
      console.log('[FirebaseUtil] Firebase Admin SDK was already initialized.');
    } else {
      console.error('[FirebaseUtil] FATAL: Firebase Admin SDK initialization failed.', error);
      // For a real application, you might want to exit the process if Firebase is critical.
      process.exit(1);
    }
  }
}
