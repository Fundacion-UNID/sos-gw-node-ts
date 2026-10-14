// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import {
  resolveHostPhysicalCollectionName,
  resolveStorageScope,
  scopePhysicalCollectionName,
} from '../../../config/storage-layout';
import { getEnvSectionId } from '../../../utils/section-env';

const KEYS = [
  'STORAGE_LAYOUT',
  'DEPLOYMENT_ENV',
  'NETWORK_MODE',
  'HOST_STORAGE_SCOPE',
  'HOST_LEGACY_PHYSICAL_COLLECTION',
  'NODE_ENV',
] as const;
const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('storage layout contract', () => {
  test('defaults to byte-for-byte legacy-v1 paths', () => {
    delete process.env.STORAGE_LAYOUT;
    process.env.NODE_ENV = 'development';

    expect(resolveStorageScope()).toEqual({ layout: 'legacy-v1' });
    expect(scopePhysicalCollectionName('ES_TAX_000_system')).toBe('ES_TAX_000_system');
    expect(getEnvSectionId('tenants')).toBe('test_tenants');
  });

  test('preserves the historical production section prefix', () => {
    process.env.STORAGE_LAYOUT = 'legacy-v1';
    process.env.NODE_ENV = 'production';

    expect(getEnvSectionId('employees')).toBe('prod_employees');
    expect(getEnvSectionId('prod_employees')).toBe('prod_employees');
  });

  test('uses the same environment-mode-host prefix for collections and sections', () => {
    process.env.STORAGE_LAYOUT = 'scoped-v2';
    process.env.DEPLOYMENT_ENV = 'staging';
    process.env.NETWORK_MODE = 'test-network';
    process.env.HOST_STORAGE_SCOPE = 'host-b';

    expect(resolveStorageScope()).toEqual({
      layout: 'scoped-v2',
      prefix: 'staging_test-network_host-b',
    });
    expect(scopePhysicalCollectionName('ES_TAX_000_system')).toBe(
      'staging_test-network_host-b__ES_TAX_000_system',
    );
    expect(getEnvSectionId('tenants')).toBe('staging_test-network_host-b_tenants');
  });

  test('keeps the host physical collection independent from operator legal identity', () => {
    process.env.STORAGE_LAYOUT = 'scoped-v2';
    process.env.DEPLOYMENT_ENV = 'staging';
    process.env.NETWORK_MODE = 'test-network';
    process.env.HOST_STORAGE_SCOPE = 'host-b';

    expect(resolveHostPhysicalCollectionName()).toBe('staging_test-network_host-b__host');
  });

  test('keeps the legacy host physical collection equal to the reserved host name', () => {
    process.env.STORAGE_LAYOUT = 'legacy-v1';

    expect(resolveHostPhysicalCollectionName()).toBe('host');
  });

  test('uses only an explicit migration pin for an existing physical host collection', () => {
    process.env.STORAGE_LAYOUT = 'scoped-v2';
    process.env.DEPLOYMENT_ENV = 'staging';
    process.env.NETWORK_MODE = 'test-network';
    process.env.HOST_STORAGE_SCOPE = 'host-b';
    process.env.HOST_LEGACY_PHYSICAL_COLLECTION = 'existing-host-registry';

    expect(resolveHostPhysicalCollectionName()).toBe('existing-host-registry');
  });

  test('rejects a migration pin that is not one exact collection identifier', () => {
    process.env.HOST_LEGACY_PHYSICAL_COLLECTION = 'existing-host/registry';

    expect(() => resolveHostPhysicalCollectionName()).toThrow(/collection identifier/);
  });

  test.each([
    ['DEPLOYMENT_ENV', undefined, 'test-network', 'host-a'],
    ['NETWORK_MODE', 'staging', undefined, 'host-a'],
    ['HOST_STORAGE_SCOPE', 'staging', 'test-network', undefined],
  ])('fails closed when %s is missing', (_missing, deployment, network, host) => {
    process.env.STORAGE_LAYOUT = 'scoped-v2';
    if (deployment) process.env.DEPLOYMENT_ENV = deployment;
    else delete process.env.DEPLOYMENT_ENV;
    if (network) process.env.NETWORK_MODE = network;
    else delete process.env.NETWORK_MODE;
    if (host) process.env.HOST_STORAGE_SCOPE = host;
    else delete process.env.HOST_STORAGE_SCOPE;

    expect(() => resolveStorageScope()).toThrow();
  });

  test('rejects a Kubernetes namespace as host storage scope', () => {
    process.env.STORAGE_LAYOUT = 'scoped-v2';
    process.env.DEPLOYMENT_ENV = 'staging';
    process.env.NETWORK_MODE = 'test-network';
    process.env.HOST_STORAGE_SCOPE = 'staging/host-a/v1';

    expect(() => resolveStorageScope()).toThrow(/lowercase slug/);
  });
});
