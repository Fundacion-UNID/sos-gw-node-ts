// src/adapters/replay-protection-store.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

export interface IReplayProtectionStore {
  /**
   * Reserves a replay key if it does not exist (or is expired).
   * @returns true when the key was reserved, false when it already exists and is still valid.
   */
  reserveIfNotExists(key: string, ttlSeconds: number): Promise<boolean>;
}

/**
 * No-op implementation used when replay protection is disabled.
 */
export class ReplayProtectionStoreNoop implements IReplayProtectionStore {
  async reserveIfNotExists(_key: string, _ttlSeconds: number): Promise<boolean> {
    return true;
  }
}

/**
 * In-memory implementation for local development/tests.
 * For distributed deployments, replace with Redis/Firestore-backed implementation.
 */
export class ReplayProtectionStoreMem implements IReplayProtectionStore {
  private readonly expiryByKey = new Map<string, number>();

  private purgeExpired(nowMs: number): void {
    for (const [key, expiresAt] of this.expiryByKey.entries()) {
      if (expiresAt <= nowMs) this.expiryByKey.delete(key);
    }
  }

  async reserveIfNotExists(key: string, ttlSeconds: number): Promise<boolean> {
    const nowMs = Date.now();
    this.purgeExpired(nowMs);

    const existingExpiry = this.expiryByKey.get(key);
    if (existingExpiry && existingExpiry > nowMs) {
      return false;
    }

    const ttlMs = Math.max(1, Math.floor(ttlSeconds)) * 1000;
    this.expiryByKey.set(key, nowMs + ttlMs);
    return true;
  }
}

/**
 * Redis-backed implementation for distributed deployments.
 * Uses `SET key value NX EX <ttl>` for atomic reserve-if-not-exists semantics.
 */
export class ReplayProtectionStoreRedis implements IReplayProtectionStore {
  private readonly redisUrl: string;
  private readonly keyPrefix: string;
  private clientPromise: Promise<any> | null = null;

  constructor(params?: { redisUrl?: string; keyPrefix?: string }) {
    this.redisUrl = params?.redisUrl || process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    this.keyPrefix = params?.keyPrefix || 'replay:jti';
  }

  private async getClient(): Promise<any> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        let redisModule: any;
        try {
          redisModule = await import('redis');
        } catch (error: any) {
          throw new Error(
            `ReplayProtectionStoreRedis requires the "redis" package. Install it with: npm i redis. ${String(error?.message || error)}`,
          );
        }
        const client = redisModule.createClient({ url: this.redisUrl });
        client.on?.('error', (err: any) => {
          console.error('[ReplayProtectionStoreRedis] Redis client error:', err?.message || err);
        });
        await client.connect();
        return client;
      })();
    }
    return this.clientPromise;
  }

  async reserveIfNotExists(key: string, ttlSeconds: number): Promise<boolean> {
    const client = await this.getClient();
    const ttl = Math.max(1, Math.floor(ttlSeconds));
    const namespacedKey = `${this.keyPrefix}:${key}`;
    const result = await client.set(namespacedKey, '1', { NX: true, EX: ttl });
    return result === 'OK';
  }
}
