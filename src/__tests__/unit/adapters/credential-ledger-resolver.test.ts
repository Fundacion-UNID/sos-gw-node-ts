import {
  resolveConfiguredLedgerProvider,
  shouldUseFabricLedger,
} from '../../../adapters/credential-ledger-resolver';

describe('ledger provider selection', () => {
  it('keeps the test runtime on memory even when other mapped modes use Fabric', () => {
    const env = {
      NETWORK_MODE: 'test',
      LEDGER_ENABLED: 'true',
      LEDGER_PROVIDER_DEFAULT: 'mem',
      LEDGER_PROVIDER_MAP: 'test=mem,test-network=fabric,network=fabric',
    };

    expect(resolveConfiguredLedgerProvider(env)).toBe('mem');
    expect(shouldUseFabricLedger(env)).toBe(false);
  });

  it('enables Fabric only when the active test-network mapping selects it', () => {
    const env = {
      NETWORK_MODE: 'test-network',
      LEDGER_ENABLED: 'false',
      LEDGER_PROVIDER_DEFAULT: 'mem',
      LEDGER_PROVIDER_MAP: 'test=mem,test-network=fabric,network=fabric',
    };

    expect(resolveConfiguredLedgerProvider(env)).toBe('fabric');
    expect(shouldUseFabricLedger(env)).toBe(true);
  });

  it('supports multi as a Fabric-backed active provider', () => {
    const env = {
      NETWORK_MODE: 'network',
      LEDGER_PROVIDER_DEFAULT: 'mem',
      LEDGER_PROVIDER_MAP: 'network=multi',
    };

    expect(resolveConfiguredLedgerProvider(env)).toBe('multi');
    expect(shouldUseFabricLedger(env)).toBe(true);
  });

  it('keeps local-network on its local Fabric topology', () => {
    expect(shouldUseFabricLedger({
      NETWORK_MODE: 'local-network',
      LEDGER_PROVIDER_DEFAULT: 'mem',
    })).toBe(true);
  });

  it('preserves explicit legacy enablement outside test when routing is absent', () => {
    expect(shouldUseFabricLedger({
      NETWORK_MODE: 'network',
      LEDGER_ENABLED: 'true',
    })).toBe(true);
  });
});
