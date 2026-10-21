import type { IServerConfig } from '../config';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import type { IStorageAdapter } from '../database/storage/IStorageAdapter';
import type { ILogger } from '../loggers/ILogger';
import { HostingManager } from '../managers/HostingManager';
import { IcaManager } from '../managers/IcaManager';
import { MessagingManager } from '../managers/MessagingManager';
import { EmployeeManager } from '../managers/EmployeeManager';
import { CredentialManager } from '../managers/CredentialManager';
import { BlockchainAdapterMem } from '../adapters/BlockchainAdapterMem';
import { BlockchainAdapterFabric } from '../adapters/BlockchainAdapterFabric';
import { BlockchainAdapterMulti } from '../adapters/BlockchainAdapterMulti';
import type { IBlockchainAdapter } from '../adapters/IBlockchainAdapter';
import { CredentialLedgerAdapterMem } from '../adapters/CredentialLedgerAdapterMem';
import { CredentialLedgerAdapterFabric } from '../adapters/CredentialLedgerAdapterFabric';
import { CredentialLedgerAdapterMulti } from '../adapters/CredentialLedgerAdapterMulti';
import {
  CredentialLedgerResolver,
  parseLedgerProviderMap,
  shouldUseFabricLedger,
} from '../adapters/credential-ledger-resolver';
import type { ICredentialLedgerAdapter } from '../adapters/ICredentialLedgerAdapter';
import { IndividualManager } from '../managers/IndividualManager';
import { FamilyManager } from '../managers/FamilyManager';
import { SubjectIdentityManager } from '../managers/SubjectIdentityManager';
import { buildSubjectIdentityLedgerPortFromEnv } from '../utils/subject-identity-ledger-port';
import { CompositionManager } from '../managers/CompositionManager';
import { TwinCompositionManager } from '../managers/TwinCompositionManager';
import { DocumentReferenceManager } from '../managers/DocumentReferenceManager';
import { CommunicationManager } from '../managers/CommunicationManager';
import { SubscriptionManager } from '../managers/SubscriptionManager';
import { DeviceRegistrationManager } from '../managers/DeviceRegistrationManager';
import { LicenseManager } from '../managers/LicenseManager';
import { AppAuthorizationManager } from '../managers/AppAuthorizationManager';
import { resolveTokenVerifierFromEnv } from '../auth/token-verifier-registry';
import { TokenManager } from '../managers/TokenManager';
import { IdentityTokenManager } from '../managers/IdentityTokenManager';
import { OpenIdAuthManager } from '../managers/OpenIdAuthManager';
import { MedicationStatementManager } from '../managers/MedicationStatementManager';
import { SchedulingManager } from '../managers/SchedulingManager';
import { CareCoordinationManager } from '../managers/CareCoordinationManager';
import { DirectoryManager } from '../managers/DirectoryManager';
import { HealthDcatManager } from '../managers/HealthDcatManager';
import { ProvenanceManager } from '../managers/ProvenanceManager';
import { RelatedPersonManager } from '../managers/RelatedPersonManager';
import { ResearchStudyManager } from '../managers/ResearchStudyManager';
import { ResearchStudyConsentManager } from '../managers/ResearchStudyConsentManager';
import { GroupManager } from '../managers/GroupManager';
import { ConsentManager } from '../managers/ConsentManager';
import { DiscoveryService } from '../services/DiscoveryService';
import { ClearingHouseService } from '../services/ClearingHouseService';
import type { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';
import { buildUnidManagers } from '../extensions/unid/build-unid-managers';
import { composeHostDidWebId } from '../utils/did-backend';
import type { ITenantsManager } from '../managers/ITenantsManager';
import type { ITenantDidRegistryMutator } from '../managers/ITenantDidRegistryMutator';
import type { IHostingTenantRegistry } from '../managers/IHostingTenantRegistry';
import type { IDiscoveryTenantRegistry } from '../managers/IDiscoveryTenantRegistry';
import type { IApiTenantRegistry } from '../managers/IApiTenantRegistry';
import type { ILedgerTenantRegistry } from '../managers/ILedgerTenantRegistry';
import { buildBreakGlassAuthorizer } from '../security/break-glass';
import { createNotificationManagerFromEnv } from '../services/notifications/factory';

const isTestEnv = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;

/**
 * Aggregate capability contract required by the runtime manager wiring.
 *
 * @security
 * This keeps the bootstrap layer honest: it depends on the minimum set of
 * interfaces needed to assemble the application, instead of depending on the
 * concrete `TenantsCacheManager` implementation directly.
 *
 * The concrete implementation may still be `TenantsCacheManager`, but that
 * choice is made by the composition root, not by the manager registry type.
 */
type IManagerRuntimeTenantRegistry =
  ITenantsManager
  & ITenantDidRegistryMutator
  & IHostingTenantRegistry
  & IDiscoveryTenantRegistry
  & IApiTenantRegistry
  & ILedgerTenantRegistry;

/**
 * Builds the manager registry used by the worker/router runtime.
 *
 * Design intent:
 * - keep core managers always available
 * - keep optional capabilities pluggable behind configuration and service exposure
 */
export function buildManagers(options: {
  config: IServerConfig;
  vaultRepository: IVaultRepository;
  kmsService: IKmsService;
  tenantManager: IManagerRuntimeTenantRegistry;
  hostCollectionName: string;
  storageAdapter: IStorageAdapter;
  logger: ILogger;
  cryptographyService: CryptographyService;
}) {
  const { config, vaultRepository, kmsService, tenantManager, storageAdapter, logger, cryptographyService } = options;
  const hostRuntime = {
    hostCollectionName: options.hostCollectionName,
    hostDid: composeHostDidWebId(config.apiBaseUrl, config.hostExternalDomain),
  };

  const clearingHouseService = new ClearingHouseService();
  const hostingManager = new HostingManager(
    vaultRepository,
    kmsService,
    tenantManager,
    storageAdapter,
    logger,
    config,
    hostRuntime,
    clearingHouseService,
    undefined,
    cryptographyService,
  );
  const icaManager = new IcaManager(vaultRepository, kmsService);
  const messagingManager = new MessagingManager(vaultRepository, kmsService);
  const employeeManager = new EmployeeManager(vaultRepository, kmsService, tenantManager, tenantManager, hostRuntime);
  const credentialManager = new CredentialManager(
    vaultRepository,
    kmsService,
    tenantManager,
    config.hostExternalDomain,
  );
  const blockchainAdapterMem = new BlockchainAdapterMem();
  const blockchainAdapterFabric = shouldUseFabricLedger() ? new BlockchainAdapterFabric() : undefined;
  const blockchainAdapter: IBlockchainAdapter = blockchainAdapterFabric
    ? new BlockchainAdapterMulti({ discoveryAdapter: blockchainAdapterMem, writeAdapter: blockchainAdapterFabric })
    : blockchainAdapterMem;
  const credentialLedgerMem = new CredentialLedgerAdapterMem();
  const credentialLedgerFabric = new CredentialLedgerAdapterFabric();
  const ledgerProviderMap = parseLedgerProviderMap(process.env.LEDGER_PROVIDER_MAP);
  const ledgerDefaultProvider = process.env.LEDGER_PROVIDER_DEFAULT || 'mem';
  const ledgerProviders: Record<string, ICredentialLedgerAdapter> = {
    mem: credentialLedgerMem,
    fabric: credentialLedgerFabric,
    multi: new CredentialLedgerAdapterMulti([credentialLedgerMem, credentialLedgerFabric]),
  };
  const credentialLedgerAdapter: ICredentialLedgerAdapter = new CredentialLedgerResolver({
    defaultProvider: ledgerDefaultProvider,
    providerMap: ledgerProviderMap,
    providers: ledgerProviders,
  });

  const individualManager = new IndividualManager(
    vaultRepository,
    kmsService,
    tenantManager,
    credentialManager,
    blockchainAdapter,
    config.namespace,
    hostRuntime,
  );

  const familyManager = new FamilyManager(
    vaultRepository,
    kmsService,
    tenantManager,
    storageAdapter,
    logger,
    config,
  );

  const compositionManager = new CompositionManager(vaultRepository, blockchainAdapter, tenantManager);
  const twinCompositionManager = new TwinCompositionManager(vaultRepository, compositionManager);
  const documentReferenceManager = new DocumentReferenceManager(vaultRepository, blockchainAdapter, tenantManager);
  const { taskService, taskManager } = buildUnidManagers({ tenantManager });
  const communicationManager = new CommunicationManager({
    tenantsCacheManager: tenantManager,
    vaultRepository,
    kmsService,
    compositionManager,
    individualManager,
    taskManager,
    blockchainAdapter,
  });
  const subscriptionManager = new SubscriptionManager({
    vaultRepository,
    kmsService,
    tenantsCacheManager: tenantManager,
  });
  const deviceRegistrationManager = new DeviceRegistrationManager(
    config.apiBaseUrl,
    vaultRepository,
    kmsService,
    tenantManager,
  );
  const licenseManager = new LicenseManager(vaultRepository, kmsService, tenantManager);
  const tokenVerifier = resolveTokenVerifierFromEnv(isTestEnv);
  const appAuthManager = new AppAuthorizationManager(
    vaultRepository,
    tokenVerifier,
    kmsService,
    cryptographyService,
  );
  const tokenManager = new TokenManager(kmsService, tenantManager);
  const identityTokenManager = new IdentityTokenManager(appAuthManager, tokenManager);
  const openIdAuthManager = new OpenIdAuthManager(
    kmsService,
    tenantManager,
    vaultRepository,
    clearingHouseService,
    buildBreakGlassAuthorizer(blockchainAdapter, vaultRepository),
  );
  const medicationStatementManager = new MedicationStatementManager(vaultRepository, tenantManager, blockchainAdapter);
  const appointmentManager = new SchedulingManager({ resourceType: 'Appointment', repository: vaultRepository, kms: kmsService, tenantManager });
  const locationManager = new SchedulingManager({ resourceType: 'Location', repository: vaultRepository, kms: kmsService, tenantManager });
  const scheduleManager = new SchedulingManager({ resourceType: 'Schedule', repository: vaultRepository, kms: kmsService, tenantManager });
  const slotManager = new SchedulingManager({ resourceType: 'Slot', repository: vaultRepository, kms: kmsService, tenantManager });
  const appointmentResponseManager = new SchedulingManager({ resourceType: 'AppointmentResponse', repository: vaultRepository, kms: kmsService, tenantManager, notificationManager: createNotificationManagerFromEnv() });
  const encounterManager = new CareCoordinationManager({ resourceType: 'Encounter', repository: vaultRepository, kms: kmsService, tenantManager });
  const serviceRequestManager = new CareCoordinationManager({ resourceType: 'ServiceRequest', repository: vaultRepository, kms: kmsService, tenantManager });
  const careTaskManager = new CareCoordinationManager({ resourceType: 'Task', repository: vaultRepository, kms: kmsService, tenantManager });
  const communicationRequestManager = new CareCoordinationManager({ resourceType: 'CommunicationRequest', repository: vaultRepository, kms: kmsService, tenantManager });
  const organizationDocumentReferenceManager = new CareCoordinationManager({ resourceType: 'DocumentReference', repository: vaultRepository, kms: kmsService, tenantManager });
  const healthcareServiceManager = new CareCoordinationManager({ resourceType: 'HealthcareService', repository: vaultRepository, kms: kmsService, tenantManager });
  const organizationDirectoryManager = new DirectoryManager({ resourceType: 'Organization', repository: vaultRepository, kms: kmsService, tenantManager });
  const placeManager = new DirectoryManager({ resourceType: 'Place', repository: vaultRepository, kms: kmsService, tenantManager });
  const serviceManager = new DirectoryManager({ resourceType: 'Service', repository: vaultRepository, kms: kmsService, tenantManager });
  const productManager = new DirectoryManager({ resourceType: 'Product', repository: vaultRepository, kms: kmsService, tenantManager });
  const catalogManager = new HealthDcatManager({ resourceType: 'Catalog', repository: vaultRepository, kms: kmsService, tenantManager });
  const datasetManager = new HealthDcatManager({ resourceType: 'Dataset', repository: vaultRepository, kms: kmsService, tenantManager });
  const catalogRecordManager = new HealthDcatManager({ resourceType: 'CatalogRecord', repository: vaultRepository, kms: kmsService, tenantManager });
  const distributionManager = new HealthDcatManager({ resourceType: 'Distribution', repository: vaultRepository, kms: kmsService, tenantManager });
  const dataServiceManager = new HealthDcatManager({ resourceType: 'DataService', repository: vaultRepository, kms: kmsService, tenantManager });
  const provenanceManager = new ProvenanceManager({ repository: vaultRepository, kms: kmsService, tenantManager });
  const relatedPersonManager = new RelatedPersonManager(vaultRepository, blockchainAdapter, tenantManager);
  const researchStudyManager = new ResearchStudyManager({ vaultRepository, kmsService, tenantManager });
  const researchStudyConsentManager = new ResearchStudyConsentManager({ vaultRepository, kmsService, tenantManager });
  const groupManager = new GroupManager({ vaultRepository, kmsService, tenantManager });
  const consentManager = new ConsentManager({ vaultRepository, blockchainAdapter, tenantsCacheManager: tenantManager });
  const subjectIdentityManager = new SubjectIdentityManager(
    vaultRepository,
    kmsService,
    tenantManager,
    buildSubjectIdentityLedgerPortFromEnv(),
  );
  const discoveryService = new DiscoveryService(tenantManager);

  return {
    hostingManager,
    icaManager,
    messagingManager,
    employeeManager,
    credentialManager,
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
    organizationDocumentReferenceManager,
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
    subjectIdentityManager,
    taskService,
    taskManager,
    discoveryService,
    clearingHouseService,
  };
}
