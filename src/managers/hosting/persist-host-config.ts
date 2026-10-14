import { ClaimsOrganizationSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { IncludedResource } from 'gdc-common-utils-ts/models/jsonapi';
import { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import { VerifiableCredentialV2 } from 'gdc-common-utils-ts/models/verifiable-credential';
import { EntityLifecycleStatus, EntityType } from '../../gdc-backend-utils-node/models/enums';
import { OrganizationConfig } from '../../gdc-backend-utils-node/models/entity';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { DidDocument } from 'gdc-common-utils-ts/models/did';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { initializeHostServicesConfig } from '../../utils/services';
import { composeHostDidWebId, populateDidDocumentFromJwks, applyLegacyX509Metadata } from '../../utils/did-backend';
import { populateDidDocumentServices } from '../../utils/did-document';
import { buildGaiaXLegalParticipantOptionsFromClaims, createGaiaXLegalParticipantCredential } from '../../utils/credential-generators';
import { getEnvSectionId } from '../../utils/section-env';
import { generateTenantCollectionNameFromClaims, getTenantVaultId } from '../../utils/tenant';
import { AllowedIndexableClaims } from '../../gdc-backend-utils-node/models/indexing';
import { registerOrganizationOnLedger } from '../../utils/ledger-organization-registration';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { PdfSignatureEvidence } from '../../utils/pdf-evidence';

type PersistHostConfigDeps = Readonly<{
  org: IncludedResource;
  allClaims: ClaimsRecord;
  contained: Array<IncludedResource | undefined>;
  config: any;
  hostRuntime: any;
  vaultRepository: any;
  kmsService: any;
  logger: any;
  isLedgerRegistrationEnabled: () => boolean;
  extractContainedService: (contained?: Array<IncludedResource | undefined>) => IncludedResource | undefined;
  extractServiceEvidence: (service?: IncludedResource) => PdfSignatureEvidence[] | undefined;
}>;

type PersistTenantConfigDeps = Readonly<{
  org: IncludedResource;
  altName: string;
  allClaims: ClaimsRecord;
  contained: Array<IncludedResource | undefined>;
  sector: Sector;
  vaultRepository: any;
  kmsService: any;
  hostRuntime: any;
  finalizeTenantConfig: (
    org: IncludedResource,
    altName: string,
    allClaims: ClaimsRecord,
    sector: Sector,
    vaultId: string,
  ) => Promise<OrganizationConfig>;
}>;

/**
 * Persists the host tenant bootstrap record and its well-known credentials.
 *
 * Required output:
 * - active host tenant config in host `tenants` section
 * - host legal participant + self-description VCs in `.well-known`
 * - optional ICA mTLS material in `pki`
 * - optional admin/service resources in their dedicated sections
 */
export async function persistHostConfig(deps: PersistHostConfigDeps): Promise<void> {
  const hostCollectionName = deps.hostRuntime.hostCollectionName;
  const logicalVaultId = 'host';

  await deps.vaultRepository.createNewVault({ id: hostCollectionName });
  await deps.kmsService.provisionKeys(logicalVaultId);

  const publicKeys = await deps.kmsService.getPublicJwks(logicalVaultId);
  const didId = composeHostDidWebId(deps.config.apiBaseUrl, deps.config.hostExternalDomain);
  const skeletonDidDoc: DidDocument = { '@context': 'https://www.w3.org/ns/did/v1', id: didId, alsoKnownAs: [] };
  const didConfigServices = initializeHostServicesConfig(
    deps.config.sectorsAllowed,
    deps.config.nodeEnv,
    deps.config.networkMode,
  );
  const baseUrl = deps.config.apiBaseUrl;
  const didDocument = populateDidDocumentFromJwks(skeletonDidDoc, publicKeys);
  const legacySignAlg = deps.config.legacySignAlg;
  const legacyX5u = legacySignAlg && deps.config.legacyX509DerBase64
    ? `${baseUrl}/host/cds-${deps.config.host.coverageScope || 'EU'}/v1/${deps.config.networkMode}/.well-known/x509.der`
    : undefined;
  const legacyChain = deps.config.legacyX509DerBase64
    ? [deps.config.legacyX509DerBase64, ...(deps.config.legacyX509ChainBase64 || [])]
    : deps.config.legacyX509ChainBase64;
  applyLegacyX509Metadata(didDocument, legacySignAlg, legacyX5u, legacyChain);
  didDocument.service = populateDidDocumentServices(didId, baseUrl, didConfigServices, false, {} as any);

  const hostConfig: OrganizationConfig = {
    id: deps.org.id,
    type: EntityType.Organization,
    status: EntityLifecycleStatus.Active,
    claims: deps.allClaims,
    didConfig: { service: didConfigServices },
    didDocument,
    networkStatus: [],
    legacySignAlg,
    legacyX509DerBase64: deps.config.legacyX509DerBase64,
    legacyX509ChainBase64: deps.config.legacyX509ChainBase64,
    meta: { lastUpdated: new Date().toISOString() },
  };

  const hostSignerKid = publicKeys.keys.find((key: any) => key.use === 'sig' && key.purpose === 'vc_sign')?.kid
    || publicKeys.keys.find((key: any) => key.use === 'sig')?.kid;
  if (!hostSignerKid) {
    throw new ManagerError('Host signing key not found, cannot issue host VCs.', IssueType.Exception);
  }

  const legalParticipantOptions = buildGaiaXLegalParticipantOptionsFromClaims({
    claims: deps.allClaims,
    webDomain: baseUrl,
    did: didId,
    issuerDid: didId,
  });
  const governanceVcPayload = createGaiaXLegalParticipantCredential(
    legalParticipantOptions,
  ) as Omit<VerifiableCredentialV2, 'proof'>;
  const govDetachedJws = await deps.kmsService.createDetachedJws(
    governanceVcPayload,
    hostSignerKid,
    logicalVaultId,
    'vc_sign',
  );
  const governanceVc: VerifiableCredentialV2 = {
    ...governanceVcPayload,
    proof: [{
      type: 'JsonWebSignature2020',
      created: new Date().toISOString(),
      proofPurpose: 'assertionMethod',
      verificationMethod: `${didId}#${hostSignerKid}`,
      jws: govDetachedJws,
    }],
  };

  const selfDescriptionPayload = { ...governanceVcPayload, issuer: didId } as Omit<VerifiableCredentialV2, 'proof'>;
  const selfDescDetachedJws = await deps.kmsService.createDetachedJws(
    selfDescriptionPayload,
    hostSignerKid,
    logicalVaultId,
    'vc_sign',
  );
  const selfDescriptionVc: VerifiableCredentialV2 = {
    ...selfDescriptionPayload,
    proof: [{
      type: 'JsonWebSignature2020',
      created: new Date().toISOString(),
      proofPurpose: 'assertionMethod',
      verificationMethod: `${didId}#${hostSignerKid}`,
      jws: selfDescDetachedJws,
    }],
  };

  hostConfig.governanceVc = governanceVc;
  hostConfig.selfDescriptionVc = selfDescriptionVc;

  if (deps.isLedgerRegistrationEnabled()) {
    const containedService = deps.extractContainedService(deps.contained);
    const serviceEvidence = deps.extractServiceEvidence(containedService);
    const orgId = (deps.allClaims as any)[ClaimsOrganizationSchemaorg.identifier] || deps.org.id;
    await registerOrganizationOnLedger({
      ledgerConfig: deps.config.ledger,
      hostJurisdiction: deps.config.host.jurisdiction,
      namespace: deps.config.namespace,
      hostExternalDomain: deps.config.hostExternalDomain,
      logger: deps.logger,
      orgId,
      organization: deps.org,
      config: hostConfig,
      evidence: serviceEvidence,
      role: 'host',
      sector: 'system' as Sector,
      jurisdiction: deps.config.host.jurisdiction,
    });
  }

  const docToProtect: ConfidentialStorageDoc = {
    id: logicalVaultId,
    status: hostConfig.status,
    sequence: 0,
    content: hostConfig,
  };
  const secureDoc = await deps.kmsService.protectConfidentialData(docToProtect, logicalVaultId);
  await deps.vaultRepository.put(hostCollectionName, [secureDoc], getEnvSectionId('tenants'));

  const mtlsCertPem = process.env.ICA_MTLS_CERT_PEM;
  const mtlsKeyPem = process.env.ICA_MTLS_KEY_PEM;
  const mtlsCaPem = process.env.ICA_MTLS_CA_PEM;
  if (mtlsCertPem && mtlsKeyPem) {
    const mtlsDoc: ConfidentialStorageDoc = {
      id: 'ica-mtls',
      status: EntityLifecycleStatus.Active,
      sequence: 0,
      content: { certPem: mtlsCertPem, keyPem: mtlsKeyPem, caPem: mtlsCaPem },
    };
    const secureMtlsDoc = await deps.kmsService.protectConfidentialData(mtlsDoc, logicalVaultId);
    await deps.vaultRepository.put(hostCollectionName, [secureMtlsDoc], getEnvSectionId('pki'));
  }

  const legalParticipantDoc: ConfidentialStorageDoc = {
    id: 'legal-participant.vc.json',
    status: 'active',
    sequence: 0,
    content: governanceVc,
  };
  const legacyVcDoc: ConfidentialStorageDoc = { id: 'vc.json', status: 'active', sequence: 0, content: governanceVc };
  const selfDescDoc: ConfidentialStorageDoc = {
    id: 'self-description.json',
    status: 'active',
    sequence: 0,
    content: selfDescriptionVc,
  };
  const secureLegalParticipantDoc = await deps.kmsService.protectConfidentialData(legalParticipantDoc, logicalVaultId);
  const secureLegacyVcDoc = await deps.kmsService.protectConfidentialData(legacyVcDoc, logicalVaultId);
  const secureSelfDescDoc = await deps.kmsService.protectConfidentialData(selfDescDoc, logicalVaultId);
  await deps.vaultRepository.put(
    hostCollectionName,
    [secureLegalParticipantDoc, secureLegacyVcDoc, secureSelfDescDoc],
    getEnvSectionId('.well-known'),
  );

  const [adminPerson, processedService] = deps.contained;
  if (adminPerson) {
    const adminDoc: ConfidentialStorageDoc = { id: adminPerson.id, status: 'active', sequence: 0, content: adminPerson };
    const secureAdminDoc = await deps.kmsService.protectConfidentialData(adminDoc, logicalVaultId);
    await deps.vaultRepository.put(hostCollectionName, [secureAdminDoc], getEnvSectionId('employees'));
  }
  if (processedService) {
    const serviceDoc: ConfidentialStorageDoc = { id: processedService.id, status: 'active', sequence: 0, content: processedService };
    const secureServiceDoc = await deps.kmsService.protectConfidentialData(serviceDoc, logicalVaultId);
    await deps.vaultRepository.put(hostCollectionName, [secureServiceDoc], getEnvSectionId('services'));
  }
}

/**
 * Persists the fully activated tenant runtime plus the onboarding artifacts that
 * the new tenant needs in its own vault.
 */
export async function persistTenantConfig(deps: PersistTenantConfigDeps): Promise<void> {
  const vaultId = getTenantVaultId(deps.sector, deps.altName);
  const tenantCollectionName = generateTenantCollectionNameFromClaims(deps.allClaims);

  await deps.vaultRepository.createNewVault({ id: tenantCollectionName });
  await deps.kmsService.provisionKeys(vaultId);

  const finalTenantConfig = await deps.finalizeTenantConfig(
    deps.org,
    deps.altName,
    deps.allClaims,
    deps.sector,
    vaultId,
  );

  const attributes = AllowedIndexableClaims.organizationRegistry
    .map((claimKey) => ({
      name: claimKey,
      value: String(deps.allClaims[claimKey]),
      ...(claimKey === ClaimsOrganizationSchemaorg.alternateName && { unique: true }),
    }))
    .filter((attr) => attr.value !== 'undefined' && attr.value !== 'null');

  const tenantRegistrationDoc: ConfidentialStorageDoc = {
    id: vaultId,
    status: finalTenantConfig.status,
    sequence: 0,
    indexed: { attributes, hmac: { id: 'urn:unsupported', type: 'Sha256HmacKey2019' } },
    content: finalTenantConfig,
  };
  const hostCollectionName = deps.hostRuntime.hostCollectionName;
  const secureTenantRegistrationDoc = await deps.kmsService.protectConfidentialData(tenantRegistrationDoc, 'host');
  await deps.vaultRepository.put(hostCollectionName, [secureTenantRegistrationDoc], getEnvSectionId('tenants'));

  const legalParticipantDoc: ConfidentialStorageDoc = {
    id: 'legal-participant.vc.json',
    status: 'active',
    sequence: 0,
    content: finalTenantConfig.governanceVc,
  };
  const legacyVcDoc: ConfidentialStorageDoc = {
    id: 'vc.json',
    status: 'active',
    sequence: 0,
    content: finalTenantConfig.governanceVc,
  };
  const selfDescDoc: ConfidentialStorageDoc = {
    id: 'self-description.json',
    status: 'active',
    sequence: 0,
    content: finalTenantConfig.selfDescriptionVc,
  };
  const secureLegalParticipantDoc = await deps.kmsService.protectConfidentialData(legalParticipantDoc, vaultId);
  const secureLegacyVcDoc = await deps.kmsService.protectConfidentialData(legacyVcDoc, vaultId);
  const secureSelfDescDoc = await deps.kmsService.protectConfidentialData(selfDescDoc, vaultId);
  await deps.vaultRepository.put(
    tenantCollectionName,
    [secureLegalParticipantDoc, secureLegacyVcDoc, secureSelfDescDoc],
    getEnvSectionId('.well-known'),
  );

  const [legalRep, processedService] = deps.contained;
  if (legalRep) {
    const legalRepDoc: ConfidentialStorageDoc = { id: legalRep.id, status: 'active', sequence: 0, content: legalRep };
    const secureLegalRepDoc = await deps.kmsService.protectConfidentialData(legalRepDoc, vaultId);
    await deps.vaultRepository.put(tenantCollectionName, [secureLegalRepDoc], getEnvSectionId('employees'));
  }
  if (processedService) {
    const serviceDoc: ConfidentialStorageDoc = { id: processedService.id, status: 'active', sequence: 0, content: processedService };
    const secureServiceDoc = await deps.kmsService.protectConfidentialData(serviceDoc, vaultId);
    await deps.vaultRepository.put(tenantCollectionName, [secureServiceDoc], getEnvSectionId('services'));
  }
}
