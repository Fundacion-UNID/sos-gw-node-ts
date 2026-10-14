import type { KeyMaterialPurpose, KeyMaterialRecord } from './key-material-provider';

function nowEpochMs(): number {
  return Date.now();
}

function buildCacheKey(entityVaultId: string, purpose: KeyMaterialPurpose): string {
  return `${entityVaultId}::${purpose}`;
}

export class TenantKeyCache<T> {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly entries = new Map<string, KeyMaterialRecord<T>>();

  constructor(options?: { ttlMs?: number; maxEntries?: number }) {
    this.ttlMs = Math.max(1_000, options?.ttlMs ?? 300_000);
    this.maxEntries = Math.max(16, options?.maxEntries ?? 1_024);
  }

  get(entityVaultId: string, purpose: KeyMaterialPurpose): KeyMaterialRecord<T> | undefined {
    const key = buildCacheKey(entityVaultId, purpose);
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if ((nowEpochMs() - entry.loadedAt) > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }

    // LRU: refresh recency on read.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  set(record: KeyMaterialRecord<T>): void {
    const key = buildCacheKey(record.entityVaultId, record.purpose);
    this.entries.set(key, record);
    this.evictIfNeeded();
  }

  invalidate(entityVaultId?: string, purpose?: KeyMaterialPurpose): void {
    if (!entityVaultId) {
      this.entries.clear();
      return;
    }

    if (!purpose || purpose === 'all') {
      for (const cacheKey of Array.from(this.entries.keys())) {
        if (cacheKey.startsWith(`${entityVaultId}::`)) {
          this.entries.delete(cacheKey);
        }
      }
      return;
    }

    this.entries.delete(buildCacheKey(entityVaultId, purpose));
  }

  private evictIfNeeded(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }
  }
}

