import type { KeyMaterialProvider, KeyMaterialPurpose, KeyMaterialRecord } from './key-material-provider';
import { TenantKeyCache } from './tenant-key-cache';

export class InMemoryKeyMaterialProvider<T> implements KeyMaterialProvider<T> {
  private readonly loader: (entityVaultId: string, purpose: KeyMaterialPurpose) => Promise<{ keyMaterial: T; keyVersion: string }>;
  private readonly cache: TenantKeyCache<T>;

  constructor(options: {
    loader: (entityVaultId: string, purpose: KeyMaterialPurpose) => Promise<{ keyMaterial: T; keyVersion: string }>;
    cache: TenantKeyCache<T>;
  }) {
    this.loader = options.loader;
    this.cache = options.cache;
  }

  async get(
    entityVaultId: string,
    purpose: KeyMaterialPurpose,
    options?: { minVersion?: string },
  ): Promise<KeyMaterialRecord<T>> {
    const cached = this.cache.get(entityVaultId, purpose);
    if (cached && (!options?.minVersion || cached.keyVersion >= options.minVersion)) {
      return cached;
    }

    const loaded = await this.loader(entityVaultId, purpose);
    const record: KeyMaterialRecord<T> = {
      entityVaultId,
      purpose,
      keyVersion: loaded.keyVersion,
      loadedAt: Date.now(),
      keyMaterial: loaded.keyMaterial,
    };
    this.cache.set(record);
    return record;
  }

  invalidate(entityVaultId?: string, purpose?: KeyMaterialPurpose): void {
    this.cache.invalidate(entityVaultId, purpose);
  }
}

