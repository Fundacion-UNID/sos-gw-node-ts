import { HostingManager } from '../../../managers/HostingManager';
import type { IKmsService } from '../../../gdc-backend-utils-node/models/IKmsService';
import type { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import type { IStorageAdapter } from '../../../database/storage/IStorageAdapter';
import type { ILogger } from '../../../loggers/ILogger';
import type { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import type { IHostRuntime } from '../../../managers/IHostRuntime';

describe('HostingManager ICA demo flow', () => {
  it('stores ICA result as messaging entry after polling', async () => {
    const mockVaultRepository = {
      put: jest.fn(async () => true),
    } as unknown as IVaultRepository;
    const mockKms = {
      protectConfidentialData: jest.fn(async (doc: any) => doc),
    } as unknown as IKmsService;
    const mockTenants = {} as TenantsCacheManager;
    const mockStorage = {} as IStorageAdapter;
    const mockLogger = { warn: jest.fn() } as unknown as ILogger;
    const mockHostRuntime = { hostCollectionName: 'host' } as IHostRuntime;

    const manager = new HostingManager(
      mockVaultRepository,
      mockKms,
      mockTenants,
      mockStorage,
      mockLogger,
      { nodeEnv: 'demo', apiBaseUrl: 'http://localhost:3000', hostExternalDomain: '', namespace: 'antifraud', sectorsAllowed: [], allowedPaymentMethods: [], dbProvider: 'mem', storageProvider: 'mem', queueProvider: 'mem', host: { jurisdiction: 'es' }, mongo: { dbName: 'default' }, firebase: {} } as any,
      mockHostRuntime,
    );

    process.env.ICA_EXTERNAL_DOMAIN = 'test-eur-ica.unid.online';

    const fetchCalls: any[] = [];
    (global as any).fetch = jest.fn(async (url: string) => {
      fetchCalls.push(url);
      if (fetchCalls.length === 1) {
        return {
          ok: false,
          status: 202,
          headers: { get: () => 'http://localhost:3000/poll' },
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{
            resource: {
              status: 'approved',
              certificate: '---CERT---',
              chain: ['---CHAIN---'],
              caName: 'ica',
            },
          }],
        }),
      };
    });

    await (manager as any).requestIcaEnrollment({
      organizationClaims: {},
      evidence: [],
      tenantVaultId: 'system_test-tenant',
    });

    expect(mockVaultRepository.put).toHaveBeenCalled();
    const storedDoc = (mockVaultRepository.put as jest.Mock).mock.calls[0][1][0];
    expect(storedDoc.content.type).toBe('IcaEnrollResponse-v1.0');
    expect(storedDoc.content.resource?.status).toBe('approved');
  });
});
