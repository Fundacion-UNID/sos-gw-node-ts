import { ReplayProtectionStoreMem } from '../../../adapters/replay-protection-store';

describe('ReplayProtectionStoreMem', () => {
  it('should reserve a new key and reject duplicates before expiry', async () => {
    const store = new ReplayProtectionStoreMem();
    await expect(store.reserveIfNotExists('k1', 60)).resolves.toBe(true);
    await expect(store.reserveIfNotExists('k1', 60)).resolves.toBe(false);
  });

  it('should allow reusing a key after ttl expiry', async () => {
    jest.useFakeTimers();
    const store = new ReplayProtectionStoreMem();

    await expect(store.reserveIfNotExists('k2', 1)).resolves.toBe(true);
    await expect(store.reserveIfNotExists('k2', 1)).resolves.toBe(false);

    jest.advanceTimersByTime(1100);
    await expect(store.reserveIfNotExists('k2', 1)).resolves.toBe(true);
    jest.useRealTimers();
  });
});

