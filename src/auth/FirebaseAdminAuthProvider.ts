// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.

import { applicationDefault, getApp, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import type { FirebaseAuthProvider, FirebaseIdTokenVerifier } from './FirebaseTokenVerifier';

/** Firebase Admin v14 adapter, kept outside the token policy and verifier orchestration. */
export class FirebaseAdminAuthProvider implements FirebaseAuthProvider {
  private readonly authByProject = new Map<string, Auth>();

  public async forProject(projectId: string, primaryProjectId: string): Promise<FirebaseIdTokenVerifier> {
    const cached = this.authByProject.get(projectId);
    if (cached) return cached;

    const auth = projectId === primaryProjectId
      ? getAuth()
      : getAuth(this.secondaryApp(projectId));
    this.authByProject.set(projectId, auth);
    return auth;
  }

  private secondaryApp(projectId: string): App {
    const name = `firebase-auth-${projectId.replace(/[^A-Za-z0-9_-]/g, '-')}`;
    try {
      return getApp(name);
    } catch {
      return initializeApp({
        credential: applicationDefault(),
        projectId,
      }, name);
    }
  }
}
