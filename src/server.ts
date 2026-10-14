const isTestEnv = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;

import { createApp, resolveRequestBodyLimit } from './app';
import * as express from 'express';
import { createServer } from 'node:http';


import { initializeFirebase } from './utils/firebase';

// Initialize Firebase Admin SDK early if configured
if (!isTestEnv && (
  process.env.DB_PROVIDER === 'firestore'
  || process.env.STORAGE_PROVIDER === 'gcs'
  || process.env.ASYNC_RESPONSE_STORE_PROVIDER === 'firestore'
)) {
  initializeFirebase();
}

import { Worker } from './worker';
import { createApiRouter } from './routes/api';
import { createDiscoveryRouter } from './routes/discovery';
import { DiscoveryService } from './services/DiscoveryService';
import { IKmsService } from './gdc-backend-utils-node/models/IKmsService';
import { IVaultRepository } from './database/repositories/vault/vault.repository';
import { ManagerRegistry } from './managers/registry';
import { HostingManager } from './managers/HostingManager';
import { TenantsCacheManager } from './managers/TenantsCacheManager';
import { EmployeeManager } from './managers/EmployeeManager';
import { IcaManager } from './managers/IcaManager';
import { MessagingManager } from './managers/MessagingManager';
import { IndividualManager } from './managers/IndividualManager';
import { CredentialManager } from './managers/CredentialManager';
import { CompositionManager } from './managers/CompositionManager';
import { BlockchainAdapterMem } from './adapters/BlockchainAdapterMem';
import { CredentialLedgerAdapterMem } from './adapters/CredentialLedgerAdapterMem';
import { createNetworkRouter } from './routes/network';
import { assertStripeWebhookConfig, createWebhooksRouter } from './routes/webhooks';
import { IBlockchainAdapter } from './adapters/IBlockchainAdapter';
import { CommunicationManager } from './managers/CommunicationManager';
import { DocumentReferenceManager } from './managers/DocumentReferenceManager';
import { DeviceRegistrationManager } from './managers/DeviceRegistrationManager';
import { IAuthorizationManager } from './managers/auth/IAuthorizationManager';
import { createFhirRouter } from './routes/fhir';
import { createGlobalErrorHandler } from './middlewares/global-error-handler';
import * as path from 'path';
import { resolveHostPhysicalCollectionName, resolveStorageScope } from './config/storage-layout';
import { assertLedgerGenesisVerificationMode } from './blockchain/fabric/v3/fabric-target-policy';
import {
  parseExpectedChannelBindings,
  verifyLedgerChannelGenesis,
  initializeRuntimeAfterLedgerProtection,
} from './services/ledger-channel-binding';
import * as swaggerUi from 'swagger-ui-express';
import { LicenseManager } from './managers/LicenseManager';
import { TokenManager } from './managers/TokenManager';
import { createAuthRouter } from './routes/auth';
import { OpenIdAuthManager } from './managers/OpenIdAuthManager';
import { ClearingHouseService } from './services/ClearingHouseService';
import { IdentityTokenManager } from './managers/IdentityTokenManager';
import { MedicationStatementManager } from './managers/MedicationStatementManager';
import { RelatedPersonManager } from './managers/RelatedPersonManager';
import { ConsentManager } from './managers/ConsentManager';
import { createApiDocsSetupOptions } from './managers/ApiDocsManager';
import { SmartAuthorizationManager } from './managers/auth/SmartAuthorizationManager';
import { AppAuthorizationManager } from './managers/AppAuthorizationManager';
import { FamilyManager } from './managers/FamilyManager';
import { registerUhcReminderExtension } from './extensions/unid/register-uhc-reminders';
import { createUhcPhoneRouter } from './routes/uhc-phone';
import { TwilioPhoneAdapter } from './adapters/phone/TwilioPhoneAdapter';
import { MockPhoneAdapter } from './adapters/phone/MockPhoneAdapter';
import { resolveTokenVerifierFromEnv } from './auth/token-verifier-registry';
import * as fs from 'fs';
import { createCredentialLedgerRouter } from './routes/ledger';
import { ICredentialLedgerAdapter } from './adapters/ICredentialLedgerAdapter';
import { CredentialLedgerAdapterMulti } from './adapters/CredentialLedgerAdapterMulti';
import { CredentialLedgerResolver, parseLedgerProviderMap } from './adapters/credential-ledger-resolver';
import { CredentialLedgerAdapterFabric } from './adapters/CredentialLedgerAdapterFabric';
import { createAuthorityRouter } from './routes/authority';
import { loadAuthorityArtifacts } from './utils/authority-artifacts';
import { generatePkiChainFromEnv } from './utils/pki-chain';
import {
  IReplayProtectionStore,
  ReplayProtectionStoreMem,
  ReplayProtectionStoreNoop,
  ReplayProtectionStoreRedis,
} from './adapters/replay-protection-store';
import { getConfig, resetServerConfig } from './config/server-config';
import { bootstrapHost } from './bootstrap/host-bootstrap';
import { registerCoreRouters } from './bootstrap/register-core-routers';
import { registerAddonRouters } from './bootstrap/register-addon-routers';
import { buildInfrastructure } from './bootstrap/build-infrastructure';
import { buildManagers } from './bootstrap/build-managers';
import { buildAsyncJobInfrastructure } from './bootstrap/build-async-job-infrastructure';

function loadSwaggerSpecFromDisk(): any {
  try {
    const swaggerSpecPath = path.resolve(process.cwd(), 'swagger-spec.json');
    return JSON.parse(fs.readFileSync(swaggerSpecPath, 'utf8'));
  } catch (error) {
    console.warn(`WARN: Could not load swagger-spec.json. Did you run \`npm run build\`? Error: ${error}`);
    return {
      openapi: '3.0.0',
      info: { title: 'Swagger Spec Not Found', version: '0.0.0' },
      paths: {},
    };
  }
}

// Load pre-generated swagger spec once; /swagger-spec.json refreshes from disk on each request.
let swaggerSpec: any = loadSwaggerSpecFromDisk();

const OPENAPI_PROFILE_DOCS = [
  { name: 'CORE', url: '/docs/openapi-profiles/openapi-core.json' },
  { name: 'COMPAT', url: '/docs/openapi-profiles/openapi-compat.json' },
  { name: 'EXTENSIONS', url: '/docs/openapi-profiles/openapi-extension.json' },
  { name: 'RUNTIME', url: '/swagger-spec.json' },
];



interface StartServerOptions {
  testMiddlewares?: express.RequestHandler[];
  authManager?: IAuthorizationManager;
  /** When false, builds the app without binding a TCP port (sandbox-safe for tests). */
  listen?: boolean;
}

function assertSecurityModeGuardrails(config: ReturnType<typeof getConfig>): void {
  const isProduction = String(config.nodeEnv || '').toLowerCase() === 'production';
  if (isProduction && config.securityMode === 'demo') {
    throw new Error("SECURITY_MODE=demo is not allowed when NODE_ENV=production.");
  }
}

function logSecurityModeCapabilities(config: ReturnType<typeof getConfig>): void {
  const acceptsDidcommEncrypted = true;
  const acceptsDidcommPlain = config.securityMode === 'demo' || config.didcommPlainEnabled;
  const acceptsLegacyJson = config.securityMode === 'demo' || config.jsonLegacy;
  const acceptsLegacyFhir = config.securityMode === 'demo' || config.fhirLegacy;
  const allowsInsecureBearer = config.securityMode === 'demo' && config.demoAllowInsecureBearer;

  console.log(
    `[GW-API] Security mode=${config.securityMode} network-mode=${config.networkMode} capabilities: `
      + `didcomm-encrypted=${acceptsDidcommEncrypted}, `
      + `didcomm-plain=${acceptsDidcommPlain}, `
      + `didcomm-plaintext-legacy=${config.didcommPlaintextLegacyMediaTypeEnabled}, `
      + `json-legacy=${acceptsLegacyJson}, `
      + `fhir-legacy=${acceptsLegacyFhir}, `
      + `insecure-bearer=${allowsInsecureBearer}`,
  );
  if (config.didcommPlaintextLegacyMediaTypeEnabled) {
    console.warn(
      '[GW-API] WARNING: legacy DIDComm media type compatibility enabled: accepting application/didcomm-plaintext+json temporarily while dependent packages are updated. Canonical media type remains application/didcomm-plain+json.',
    );
  }
}

/**
 * Initializes and starts the Express server.
 */
async function startServer(options?: StartServerOptions) {
  const config = getConfig();
  assertSecurityModeGuardrails(config);
  assertStripeWebhookConfig();
  logSecurityModeCapabilities(config);

  // Initialize a baseline Swagger server URL; /swagger-spec.json will refine it per-request.
  if (swaggerSpec.info.title !== 'Swagger Spec Not Found') {
    swaggerSpec.servers = [{
      url: config.apiBaseUrl,
      description: `Server URL for ${config.nodeEnv} environment`,
    }];
  }

  const app = createApp();
  app.use(express.urlencoded({
    extended: true,
    limit: resolveRequestBodyLimit(),
  }));

  if (options?.testMiddlewares) {
    options.testMiddlewares.forEach((mw) => app.use(mw));
  }

  // Host registry persistence is deployment-scoped and never derived from the
  // legal organization currently operating the host.
  const hostCollectionName = resolveHostPhysicalCollectionName();
  
  // --- DEPENDENCY INJECTION ---
  const storageScope = resolveStorageScope();
  let observedLedgerBindings;
  if (storageScope.layout === 'scoped-v2') {
    const verifyGenesis = String(process.env.LEDGER_GENESIS_VERIFICATION || '')
      .trim()
      .toLowerCase() === 'true';
    const deploymentEnv = String(process.env.DEPLOYMENT_ENV || '').trim().toLowerCase();
    const networkMode = String(process.env.NETWORK_MODE || '').trim().toLowerCase();
    assertLedgerGenesisVerificationMode({ deploymentEnv, networkMode, enabled: verifyGenesis });
    if (verifyGenesis) {
      const ledgerMspId = String(process.env.LEDGER_MSP_ID || process.env.HLF_MSP_ID_ORG1 || '').trim();
      if (!ledgerMspId) throw new Error('genesis verification requires LEDGER_MSP_ID.');
      const expected = parseExpectedChannelBindings(process.env.LEDGER_CHANNEL_GENESIS_SHA256);
      observedLedgerBindings = await verifyLedgerChannelGenesis({ mspId: ledgerMspId, expected });
    }
  }

  const {
    vaultRepository,
    storageAdapter,
    cryptographyService,
    logger,
    tenantManager,
    kmsService,
  } = await buildInfrastructure({ config, hostCollectionName, initializeKms: false });

  if (observedLedgerBindings) {
    await initializeRuntimeAfterLedgerProtection({
      vaultRepository,
      hostCollectionName,
      observed: observedLedgerBindings,
      initializeRuntime: () => kmsService.init(),
    });
  } else {
    await kmsService.init();
  }
  const {
    hostingManager,
    icaManager,
    messagingManager,
    employeeManager,
    blockchainAdapter,
    credentialLedgerAdapter,
    individualManager,
    familyManager,
    compositionManager,
    twinCompositionManager,
    documentReferenceManager,
    communicationManager,
    subscriptionManager,
    deviceRegistrationManager,
    licenseManager,
    appAuthManager,
    tokenManager,
    identityTokenManager,
    openIdAuthManager,
    subjectIdentityManager,
    medicationStatementManager,
    appointmentManager,
    locationManager,
    scheduleManager,
    slotManager,
    appointmentResponseManager,
    encounterManager,
    serviceRequestManager,
    careTaskManager,
    communicationRequestManager,
    healthcareServiceManager,
    organizationDirectoryManager,
    placeManager,
    serviceManager,
    productManager,
    catalogManager,
    datasetManager,
    catalogRecordManager,
    distributionManager,
    dataServiceManager,
    provenanceManager,
    relatedPersonManager,
    researchStudyManager,
    researchStudyConsentManager,
    groupManager,
    consentManager,
    taskService,
    taskManager,
    discoveryService,
  } = buildManagers({
    config,
    vaultRepository,
    kmsService,
    tenantManager,
    hostCollectionName,
    storageAdapter,
    logger,
    cryptographyService,
  });

  /**
   * Resolve the current host registration from the physical host collection.
   *
   * Keep startup behavior aligned with the older stable path used in v1.8.5:
   * - first try to warm the host cache
   * - if the host registration is still absent, bootstrap it
   * - then explicitly load it again
   *
   * This preserves the previous startup sequence while still allowing an
   * opt-in non-fatal fallback for environments where Firestore auth is
   * temporarily broken during rollout/debugging.
   */
  try {
    await tenantManager.loadHost();
    const hostTenant = await tenantManager.getTenant('host');
    if (!hostTenant) {
      console.log('[GW-API] Host tenant not found. Bootstrapping...');
      await bootstrapHost(hostingManager, config);
      // After bootstrapping, explicitly warm the cache again using the legacy
      // full-read path to preserve the previous startup semantics.
      console.log('[GW-API] Warming up host cache after bootstrap...');
      await tenantManager.getTenant('host');
    } else {
      const updated = await hostingManager.reconcilePersistedHostRuntimeConfig();
      if (updated) {
        console.log('[GW-API] Reconciled persisted host runtime service config.');
      }
    }
    const reconciledRepresentativeInventories = await hostingManager.reconcileLegacyRepresentativeSeatInventories();
    if (reconciledRepresentativeInventories > 0) {
      console.log(`[GW-API] Reconciled ${reconciledRepresentativeInventories} historical representative seat inventories.`);
    }
    const reconciledTenantServiceCatalogs = await hostingManager.reconcileTenantServiceCatalog();
    if (reconciledTenantServiceCatalogs > 0) {
      console.log(`[GW-API] Reconciled canonical service catalogs for ${reconciledTenantServiceCatalogs} tenants.`);
    }
  } catch (error) {
    const allowStartupWithoutHostWarmup =
      String(process.env.STARTUP_SKIP_HOST_CACHE_WARMUP_ON_ERROR || '').trim().toLowerCase() === 'true';
    console.warn(
      '[GW-API] Host startup cache warmup failed.'
      + (allowStartupWithoutHostWarmup ? ' Continuing because STARTUP_SKIP_HOST_CACHE_WARMUP_ON_ERROR=true.' : ''),
      error,
    );
    if (!allowStartupWithoutHostWarmup) {
      throw error;
    }
  }

  const managerRegistry: ManagerRegistry = {
    hostingManager,
    tenantManager,
    icaManager,
    messagingManager,
    identityTokenManager,
    taskManager,
    medicationStatementManager,
    appointmentManager,
    locationManager,
    scheduleManager,
    slotManager,
    appointmentResponseManager,
    encounterManager,
    serviceRequestManager,
    careTaskManager,
    communicationRequestManager,
    healthcareServiceManager,
    organizationDirectoryManager,
    placeManager,
    serviceManager,
    productManager,
    catalogManager,
    datasetManager,
    catalogRecordManager,
    distributionManager,
    dataServiceManager,
    provenanceManager,
    relatedPersonManager,
    researchStudyManager,
    researchStudyConsentManager,
    groupManager,
    familyManager,
    employeeManager,
    individualManager,
    consentManager,
    compositionManager,
    twinCompositionManager,
    documentReferenceManager,
    communicationManager,
    subscriptionManager,
    deviceRegistrationManager,
    licenseManager,
    openIdAuthManager,
    subjectIdentityManager,
  };
  const worker = new Worker(managerRegistry, config.apiBaseUrl, kmsService);
  const { asyncResponseStore, queueAdapter } = await buildAsyncJobInfrastructure({
    queueProvider: config.queueProvider,
    responseStoreProvider: process.env.ASYNC_RESPONSE_STORE_PROVIDER,
    worker,
  });
  const replayProvider = (process.env.REPLAY_PROTECTION_PROVIDER || 'none').toLowerCase();
  const replayProtectionStore: IReplayProtectionStore =
    replayProvider === 'mem'
      ? new ReplayProtectionStoreMem()
      : replayProvider === 'redis'
        ? new ReplayProtectionStoreRedis({
            redisUrl: process.env.REDIS_URL,
            keyPrefix: process.env.REPLAY_REDIS_KEY_PREFIX || 'replay:jti',
          })
        : new ReplayProtectionStoreNoop();
  
  // This is the FHIR-specific AuthorizationManager, not our AppAuthorizationManager.
  const authManager: IAuthorizationManager = options?.authManager || new SmartAuthorizationManager();

  const discoveryRouter = createDiscoveryRouter(tenantManager, discoveryService, kmsService, logger, vaultRepository);

  const authorityArtifacts: Record<string, ReturnType<typeof loadAuthorityArtifacts>> = {};
  const roles = new Set(config.localServiceRoles || []);
  if (roles.has('CA') || roles.has('ICA')) {
    const artifactsRoot = path.join(process.cwd(), 'artifacts');
    const rootDir = process.env.LOCAL_CA_ARTIFACTS_DIR || path.join(artifactsRoot, 'full-pki-chain-root-ca');
    const icaDir = process.env.LOCAL_ICA_ARTIFACTS_DIR || path.join(artifactsRoot, 'full-pki-chain-ica');
    const needsRoot = roles.has('CA') && !fs.existsSync(rootDir);
    const needsIca = roles.has('ICA') && !fs.existsSync(icaDir);

    if (needsRoot || needsIca) {
      const isDemo = config.nodeEnv === 'demo' || process.env.DEV_SEED === 'true';
      if (isDemo) {
        console.log('[GW-API] Missing authority artifacts. Generating demo PKI chain from env...');
        await generatePkiChainFromEnv({ cleanOutput: true });
      } else {
        throw new Error(`[GW-API] Missing authority artifacts. Expected ${rootDir} and ${icaDir}`);
      }
    }

    if (roles.has('CA')) {
      authorityArtifacts.CA = loadAuthorityArtifacts('CA', rootDir);
    }
    if (roles.has('ICA')) {
      const rootDerPath = path.join(rootDir, 'root-cert.der');
      authorityArtifacts.ICA = loadAuthorityArtifacts('ICA', icaDir, rootDerPath);
    }
  }
  const authorityRouter = Object.keys(authorityArtifacts).length
    ? createAuthorityRouter(authorityArtifacts, asyncResponseStore)
    : undefined;
  const apiRouter = createApiRouter(
    queueAdapter,
    tenantManager,
    kmsService,
    asyncResponseStore,
    vaultRepository,
    cryptographyService,
    config.apiBaseUrl,
    appAuthManager,
    replayProtectionStore,
    worker,
  );
  const networkRouter = createNetworkRouter(queueAdapter, kmsService);
  const fhirRouter = createFhirRouter(queueAdapter, authManager);
  const ledgerRouter = createCredentialLedgerRouter(credentialLedgerAdapter, asyncResponseStore, tenantManager, config.networkMode);
  const webhooksRouter = createWebhooksRouter(queueAdapter);
  const authRouter = createAuthRouter(appAuthManager, tokenManager);
  registerCoreRouters({
    app,
    discoveryRouter,
    authorityRouter,
    ledgerRouter,
    apiRouter,
    networkRouter,
    fhirRouter,
    webhooksRouter,
    authRouter,
  });

  // UHC reminders extension hook (kept modular and isolated from GW core services).
  registerUhcReminderExtension({
    app,
    config,
    taskService,
    vaultRepository,
    kmsService,
    tenantManager,
  });

  if (config.uhcTelephony?.verifyEnabled) {
    const twilioCfg = config.uhcTelephony?.twilio;
    const phoneAdapter =
      config.uhcTelephony?.provider === 'twilio' && twilioCfg?.accountSid && twilioCfg?.authToken
        ? new TwilioPhoneAdapter({
            accountSid: twilioCfg.accountSid,
            authToken: twilioCfg.authToken,
            apiKeySid: twilioCfg.apiKeySid,
            apiKeySecret: twilioCfg.apiKeySecret,
            messagingServiceSid: twilioCfg.messagingServiceSid || '',
            verifyServiceSid: twilioCfg.verifyServiceSid,
            voiceFromNumber: twilioCfg.voiceFromNumber,
          })
        : new MockPhoneAdapter();

    registerAddonRouters(app, [
      {
        mountPath: '/uhc/phone',
        router: createUhcPhoneRouter({
          phoneAdapter,
          isVerifyEnabled: config.uhcTelephony.verifyEnabled === true,
          defaultLocale: config.uhcTelephony.defaultLocale || 'en',
        }),
      },
    ]);
  }

  // --- Global Error Handling Middleware (MUST be the LAST middleware) ---
  app.use(createGlobalErrorHandler(logger));

  app.get('/swagger-spec.json', (req: express.Request, res: express.Response) => {
    const runtimeSwaggerSpec = loadSwaggerSpecFromDisk();
    res.setHeader('Cache-Control', 'no-store');
    if (runtimeSwaggerSpec.info.title === 'Swagger Spec Not Found') {
      res.json(runtimeSwaggerSpec);
      return;
    }

    const forwardedProto = req.headers['x-forwarded-proto'];
    const forwardedHost = req.headers['x-forwarded-host'];
    const protocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)
      ?.split(',')[0]
      ?.trim() || req.protocol;
    const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) || req.get('host');
    const baseUrl = host ? `${protocol}://${host}` : config.apiBaseUrl;

    res.json({
      ...runtimeSwaggerSpec,
      servers: [{
        url: baseUrl,
        description: `Server URL for ${config.nodeEnv} environment`,
      }],
    });
  });

  app.use(
    '/docs/openapi-profiles',
    express.static(path.resolve(process.cwd(), 'docs', 'openapi-profiles'), {
      setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-store');
      },
    }),
  );

  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(undefined, createApiDocsSetupOptions('/swagger-spec.json', OPENAPI_PROFILE_DOCS) as any),
  );

  const server =
    options?.listen === false
      ? undefined
      : createServer({ maxHeaderSize: config.maxHeaderSize }, app).listen(config.port, config.apiHostname, () => {
          console.log(`[GW-API] Listening on ${config.apiHostname}:${config.port}`);
        });

  return { app, server, queueAdapter, tenantManager, vaultRepository, cryptographyService, blockchainAdapter, credentialLedgerAdapter, kmsService };
}

export { startServer, resetServerConfig };
