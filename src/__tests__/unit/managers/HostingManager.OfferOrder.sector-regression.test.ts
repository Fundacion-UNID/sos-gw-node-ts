// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { resolveHostPhysicalCollectionName } from '../../../config/storage-layout';
import { beforeEach } from '@jest/globals';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { HostingManager } from '../../../managers/HostingManager';
import { IServerConfig } from '../../../config';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { ORGANIZATION_REGISTRATION_JOB } from '../../data/example-jobs';
import { testClaimsHostInitialization } from '../../data/end-to-end.data';
import { ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import * as tenantUtils from '../../../utils/tenant';
import { mockKmsService, mockStorageAdapter, mockLogger } from './HostingManager.OfferOrder.test';

let hostingManager: InstanceType<typeof HostingManager>;

beforeEach(async () => {
  jest.clearAllMocks();
  const vaultRepository = new VaultMemRepository();
  const hostCollectionName = resolveHostPhysicalCollectionName();
  const mockTenantsCacheManager = new TenantsCacheManager(
    vaultRepository,
    () => mockKmsService,
    hostCollectionName,
  ) as any;
  const mockConfig: IServerConfig = {
    securityMode: 'demo',
    networkMode: 'test',
    fhirLegacy: true,
    jsonLegacy: true,
    didcommPlainEnabled: true,
    demoAllowInsecureBearer: true,
    nodeEnv: 'test',
    port: 3000,
    maxHeaderSize: 16 * 1024,
    apiHostname: 'testhost',
    hostExternalDomain: 'testhost.com',
    apiBaseUrl: 'http://testhost:3000',
    namespace: 'test-namespace',
    sectorsAllowed: [Sector.HEALTH_CARE, Sector.SYSTEM, Sector.HEALTH_INSURANCE],
    dbProvider: 'mem',
    queueProvider: 'mem',
    storageProvider: 'mem',
    allowedPaymentMethods: ['Stripe'],
    host: {
      legalName: 'Test Host',
      jurisdiction: 'us',
      idType: 'test-id',
      idValue: '12345',
    },
    mongo: { dbName: 'test' },
    firebase: {},
  };
  hostingManager = new HostingManager(
    vaultRepository,
    mockKmsService,
    mockTenantsCacheManager,
    mockStorageAdapter,
    mockLogger,
    mockConfig,
  );
  mockKmsService.getPublicJwks.mockResolvedValue({
    keys: [
      { kid: 'sig-key-1', use: 'sig', alg: 'ML-DSA-44' } as any,
      { kid: 'enc-key-1', use: 'enc', crv: 'ML-KEM-768' } as any,
    ],
  });
  mockKmsService.provisionKeys.mockResolvedValue({
    keys: [
      { kty: 'AKP', kid: 'sig-key-1', use: 'sig', alg: 'ML-DSA-44' },
      { kty: 'OKP', kid: 'enc-key-1', use: 'enc', crv: 'ML-KEM-768' },
    ],
  } as any);
  await hostingManager.bootstrapHost(testClaimsHostInitialization);
  await mockTenantsCacheManager.loadHost();
  mockStorageAdapter.upload.mockResolvedValue({
    publicUrl: 'https://storage.example.com/terms.pdf',
    encodedMultiHash: 'zQm...',
  });
});

test('should FAIL if tenant vaultId is constructed with network sector instead of business sector', async () => {
  const job = structuredClone(ORGANIZATION_REGISTRATION_JOB);
  const registrationClaims = job.content?.body?.data?.[0]?.resource?.meta?.claims;
  if (!registrationClaims) {
    throw new Error('Malformed ORGANIZATION_REGISTRATION_JOB fixture');
  }
  // Forzamos el sector a uno de red (incorrecto para tenant)
  registrationClaims[ClaimsServiceSchemaorg.category] = Sector.TEST;
  // El manager encapsula errores en el bundle de respuesta (no lanza excepción aquí).
  const response = await hostingManager.process(job as any);
  const issue = (response as any)?.body?.data?.[0]?.response?.outcome?.issue?.[0];
  expect((response as any)?.body?.data?.[0]?.response?.status).toBe('400');
  expect(String(issue?.diagnostics || '')).toContain("The requested sector 'test' is not supported");
});
