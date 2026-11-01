// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
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

  it.each([
    ['ttl expiry', (cache: TenantKeyCache<Uint8Array>) => cache.get('tenant-a', 'hmac')],
    ['scoped invalidation', (cache: TenantKeyCache<Uint8Array>) => cache.invalidate('tenant-a', 'hmac')],
    ['tenant invalidation', (cache: TenantKeyCache<Uint8Array>) => cache.invalidate('tenant-a')],
    ['global invalidation', (cache: TenantKeyCache<Uint8Array>) => cache.invalidate()],
  ])('disposes secret bytes on %s', (_caseName, remove) => {
    const secret = new Uint8Array([7, 8, 9]);
    const cache = new TenantKeyCache<Uint8Array>({
      ttlMs: 1_000,
      maxEntries: 16,
      dispose: (keyMaterial) => keyMaterial.fill(0),
    });
    cache.set({
      entityVaultId: 'tenant-a',
      purpose: 'hmac',
      keyVersion: '1',
      loadedAt: Date.now() - 5_000,
      keyMaterial: secret,
    });

    remove(cache);

    expect(Array.from(secret)).toEqual([0, 0, 0]);
  });

  it('disposes replaced and least-recently-used secret bytes', () => {
    const disposed: Uint8Array[] = [];
    const cache = new TenantKeyCache<Uint8Array>({
      ttlMs: 60_000,
      maxEntries: 16,
      dispose: (keyMaterial) => {
        keyMaterial.fill(0);
        disposed.push(keyMaterial);
      },
    });
    const replacedSecret = new Uint8Array([1]);
    cache.set({
      entityVaultId: 'tenant-0', purpose: 'all', keyVersion: '1', loadedAt: Date.now(), keyMaterial: replacedSecret,
    });
    cache.set({
      entityVaultId: 'tenant-0', purpose: 'all', keyVersion: '2', loadedAt: Date.now(), keyMaterial: new Uint8Array([2]),
    });
    for (let index = 1; index <= 16; index += 1) {
      cache.set({
        entityVaultId: `tenant-${index}`,
        purpose: 'all',
        keyVersion: '1',
        loadedAt: Date.now(),
        keyMaterial: new Uint8Array([index]),
      });
    }

    expect(Array.from(replacedSecret)).toEqual([0]);
    expect(disposed).toHaveLength(2);
    expect(Array.from(disposed[1])).toEqual([0]);
  });
});
