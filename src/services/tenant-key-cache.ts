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
  private readonly dispose?: (keyMaterial: T) => void;
  private readonly entries = new Map<string, KeyMaterialRecord<T>>();

  constructor(options?: { ttlMs?: number; maxEntries?: number; dispose?: (keyMaterial: T) => void }) {
    this.ttlMs = Math.max(1_000, options?.ttlMs ?? 300_000);
    this.maxEntries = Math.max(16, options?.maxEntries ?? 1_024);
    this.dispose = options?.dispose;
  }

  get(entityVaultId: string, purpose: KeyMaterialPurpose): KeyMaterialRecord<T> | undefined {
    const key = buildCacheKey(entityVaultId, purpose);
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if ((nowEpochMs() - entry.loadedAt) > this.ttlMs) {
      this.remove(key);
      return undefined;
    }

    // LRU: refresh recency on read.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  set(record: KeyMaterialRecord<T>): void {
    const key = buildCacheKey(record.entityVaultId, record.purpose);
    const replaced = this.entries.get(key);
    if (replaced && replaced.keyMaterial !== record.keyMaterial) {
      this.dispose?.(replaced.keyMaterial);
    }
    this.entries.set(key, record);
    this.evictIfNeeded();
  }

  invalidate(entityVaultId?: string, purpose?: KeyMaterialPurpose): void {
    if (!entityVaultId) {
      for (const cacheKey of Array.from(this.entries.keys())) this.remove(cacheKey);
      return;
    }

    if (!purpose || purpose === 'all') {
      for (const cacheKey of Array.from(this.entries.keys())) {
        if (cacheKey.startsWith(`${entityVaultId}::`)) {
          this.remove(cacheKey);
        }
      }
      return;
    }

    this.remove(buildCacheKey(entityVaultId, purpose));
  }

  private remove(cacheKey: string): void {
    const entry = this.entries.get(cacheKey);
    if (!entry) return;
    this.entries.delete(cacheKey);
    this.dispose?.(entry.keyMaterial);
  }

  private evictIfNeeded(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) break;
      this.remove(oldestKey);
    }
  }
}
