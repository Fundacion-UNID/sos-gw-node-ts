// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { resolveHostPhysicalCollectionName } from '../../../config/storage-layout';
import * as express from 'express';
import { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';
import type { IServerConfig } from '../../../config';
import { AsyncResponseStoreMem } from '../../../adapters/async-response-store.mem';
import { QueueAdapterMem } from '../../../adapters/queue-mem';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { StorageMemAdapter } from '../../../database/storage/mem.storage.adapter';
import { HostingManager } from '../../../managers/HostingManager';
import { ManagerRegistry } from '../../../managers/registry';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { ConsoleLogger } from '../../../loggers/ConsoleLogger';
import { createApiRouter } from '../../../routes/api';
import { KmsService } from '../../../services/KmsService';
import { InMemoryEnvelopeAdapter } from '../../../services/kms-envelope-adapter';
import { VaultWrappedKeyRepository } from '../../../services/wrapped-key-repository';
import { Worker } from '../../../worker';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import type { IHostRuntime } from '../../../managers/IHostRuntime';
import { testClaimsHostInitialization } from '../../data/end-to-end.data';
import { generateTenantCollectionNameFromClaims } from '../../../utils/tenant';
import { AdapterCryptoSdkNode } from '../../../gdc-backend-utils-node/adapters/node/crypto';
import { testAnimalResearchSector } from '../../data/organization-registration-replay.data';

export type RestartableGatewayHarness = Readonly<{
  app: express.Express;
  queueAdapter: QueueAdapterMem;
  kmsService: KmsService;
  vaultRepository: VaultMemRepository;
  hostCollectionName: string;
}>;

/**
 * Rebuilds every process-local GW service over one explicitly supplied
 * durable repository. Tests call this twice to prove that no manager cache,
 * queue state or KMS instance carries an onboarding continuation implicitly.
 */
export async function buildRestartableGateway(
  vaultRepository: VaultMemRepository,
): Promise<RestartableGatewayHarness> {
  const hostCollectionName = resolveHostPhysicalCollectionName();
  const cryptographyService = new CryptographyService(new AdapterCryptoSdkNode());
  const logger = new ConsoleLogger();
  const asyncResponseStore = new AsyncResponseStoreMem();
  let kmsService: KmsService;
  const tenantManager = new TenantsCacheManager(vaultRepository, () => kmsService, hostCollectionName);
  kmsService = new KmsService(cryptographyService, tenantManager, {
    wrappedKeyRepository: new VaultWrappedKeyRepository(vaultRepository, hostCollectionName),
    envelopeAdapter: new InMemoryEnvelopeAdapter(),
  });
  await kmsService.init();

  const config: IServerConfig = {
    securityMode: 'demo',
    networkMode: 'test',
    fhirLegacy: true,
    jsonLegacy: true,
    didcommPlainEnabled: true,
    demoAllowInsecureBearer: true,
    nodeEnv: 'test',
    port: 3000,
    maxHeaderSize: 131072,
    apiHostname: 'testhost',
    hostExternalDomain: 'testhost.com',
    apiBaseUrl: 'http://testhost:3000',
    namespace: 'test-namespace',
    sectorsAllowed: [testAnimalResearchSector, Sector.TEST],
    allowedPaymentMethods: ['Stripe'],
    dbProvider: 'mem',
    queueProvider: 'mem',
    storageProvider: 'mem',
    host: { legalName: 'Test Host', jurisdiction: 'ES', idType: 'TAX', idValue: 'VATES-B00000000' },
    ica: { mode: 'external', externalUrl: 'https://ica.example.com', jurisdiction: 'ES' },
    mongo: { dbName: 'test' },
    firebase: {},
  };
  const hostRuntime: IHostRuntime = { hostCollectionName, hostDid: 'did:web:testhost.com' };
  const hostingManager = new HostingManager(
    vaultRepository,
    kmsService,
    tenantManager,
    new StorageMemAdapter(),
    logger,
    config,
    hostRuntime,
  );
  if (!await vaultRepository.vaultExists('host')) {
    await hostingManager.bootstrapHost(testClaimsHostInitialization as any);
  }
  await tenantManager.loadHost();

  const managerRegistry: ManagerRegistry = { hostingManager, tenantManager };
  const worker = new Worker(managerRegistry, config.apiBaseUrl, kmsService);
  const queueAdapter = new QueueAdapterMem(asyncResponseStore, worker);
  const app = express.default();
  app.use(express.json({ type: ['application/json', 'application/fhir+json'] }));
  app.use(express.urlencoded({ extended: false }));
  app.use('/', createApiRouter(
    queueAdapter,
    tenantManager,
    kmsService,
    asyncResponseStore,
    vaultRepository,
    cryptographyService,
    config.apiBaseUrl,
  ));
  return { app, queueAdapter, kmsService, vaultRepository, hostCollectionName };
}
