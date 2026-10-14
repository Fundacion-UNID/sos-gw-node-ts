import { TenantKeyCache } from '../../../services/tenant-key-cache';

describe('TenantKeyCache', () => {
  it('stores and retrieves non-expired records', () => {
    const cache = new TenantKeyCache<string>({ ttlMs: 60_000, maxEntries: 32 });
    cache.set({
      entityVaultId: 'tenant-a',
      purpose: 'hmac',
      keyVersion: '1',
      loadedAt: Date.now(),
      keyMaterial: 'secret-a',
    });

    const record = cache.get('tenant-a', 'hmac');
    expect(record?.keyMaterial).toBe('secret-a');
  });

  it('expires records by ttl', () => {
    const cache = new TenantKeyCache<string>({ ttlMs: 1_000, maxEntries: 32 });
    cache.set({
      entityVaultId: 'tenant-a',
      purpose: 'hmac',
      keyVersion: '1',
      loadedAt: Date.now() - 5_000,
      keyMaterial: 'secret-a',
    });

    const record = cache.get('tenant-a', 'hmac');
    expect(record).toBeUndefined();
  });

  it('supports scoped invalidation', () => {
    const cache = new TenantKeyCache<string>({ ttlMs: 60_000, maxEntries: 32 });
    cache.set({
      entityVaultId: 'tenant-a',
      purpose: 'hmac',
      keyVersion: '1',
      loadedAt: Date.now(),
      keyMaterial: 'hmac-a',
    });
    cache.set({
      entityVaultId: 'tenant-a',
      purpose: 'storage',
      keyVersion: '1',
      loadedAt: Date.now(),
      keyMaterial: 'storage-a',
    });

    cache.invalidate('tenant-a', 'hmac');
    expect(cache.get('tenant-a', 'hmac')).toBeUndefined();
    expect(cache.get('tenant-a', 'storage')?.keyMaterial).toBe('storage-a');
  });
});

