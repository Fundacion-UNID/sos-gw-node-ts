import { v4 as uuidv4 } from 'uuid';
import type { BundleEntry, BundleJsonApi, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { DidCommDecodedMetadata, IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import type { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import type { PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import type { DidDocument } from 'gdc-common-utils-ts/models/did';
import type { EntityConfig, OrganizationConfig } from '../../gdc-backend-utils-node/models/entity';
import type { VerifiableCredentialV2 } from 'gdc-common-utils-ts/models/verifiable-credential';
import {
  ClaimsOrganizationSchemaorg,
  ClaimsServiceSchemaorg,
} from 'gdc-common-utils-ts/constants/schemaorg';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { getBundleResponseTypeForAction } from '../../utils/bundle';
import { normalizeContextualizedClaims } from '../../utils/claims';
import { validateNewOrganizationClaims } from '../../utils/claims-validator';
import { generateTenantCollectionNameFromClaims, getTenantVaultId, isValidTenantAlternateName } from '../../utils/tenant';
import { getEnvSectionId } from '../../utils/section-env';
import { buildOfferOrderIndexedAttributes } from '../../utils/offer-order-read-model';
import { createOrganizationUrn } from '../../utils/urn';
import { registerOrganizationOnLedger } from '../../utils/ledger-organization-registration';
import { parseServiceCapabilityTokens } from 'gdc-common-utils-ts/constants/service-capabilities';
import { validateActivationServiceAuthorizationPolicy } from 'gdc-common-utils-ts/utils/activation-policy';
import type { Sector } from 'gdc-common-utils-ts/models/urlPath';
import type { NetworkName } from '../../gdc-backend-utils-node/models/enums';
import { composeHostDidWebId, createHostedDidWeb } from '../../utils/did-backend';
import {
  HOST_ACTIVATE_REQUIRED_INPUT_CLAIMS,
  HOST_ACTIVATE_REQUIRED_OUTPUT_CLAIMS,
} from './hosting-claim-contracts';
import { allowsLegacyRepresentativeBootstrap } from './legacy-representative-bootstrap-policy';
import { GatewayResponseEntryTypes } from 'gdc-common-utils-ts/constants/gateway-response';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { GatewayClaim } from '../../shared/gateway-claim-contract';

type ActivationParticipantMaterial = {
  did?: string;
  sameAs?: string;
  publicKeyJwk?: PublicJwk;
  jwks?: { keys: any[] };
};

type ActivationMaterial = {
  vpToken: any;
  presentationSubmission: any;
  organizationCredential: any;
  representativeCredential: any;
  controllerCredential: any;
  legacyOrganizationCredential: any;
  legacyRepresentativeCredential: any;
  legacyControllerCredential: any;
  primaryDid: any;
  publicTenantUrl: any;
  organizationBinding?: ActivationParticipantMaterial;
  controllerBinding?: ActivationParticipantMaterial;
};

type ActivationDeps = Readonly<{
  job: JobRequest;
  environment?: string;
  issuerDid: string;
  config: any;
  hostRuntime: { hostCollectionName?: string };
  logger: any;
  vaultRepository: any;
  kmsService: any;
  activationTrustAdapter: any;
  handleError: (error: any, entryType?: string, meta?: any) => ErrorEntry;
  extractActivationMaterial: (entry: BundleEntry, body: any) => ActivationMaterial;
  applyDemoRepresentativeBindingFallback: (activation: ActivationMaterial, jobMeta?: DidCommDecodedMetadata) => Promise<ActivationMaterial>;
  warnOnLegacyActivationCredentialFields: (activation: ActivationMaterial) => void;
  backfillOrganizationActivationRouteDefaults: (claims: ClaimsRecord, routeJurisdiction?: string) => ClaimsRecord;
  applyLegalOrganizationIdentityCompatibility: (claims: ClaimsRecord, organizationCredential?: unknown) => ClaimsRecord;
  logActivationIdentityDiagnostics: (stage: string, claims: ClaimsRecord, routeJurisdiction?: string) => void;
  normalizeTenantPublicUrl: (urlOrDomain?: string) => string | undefined;
  createOrganizationUrnSafely: (claims: ClaimsRecord, requestedSector: Sector) => string;
  withHostedOrganizationOfferClaims: (claims: ClaimsRecord, requestedSector: Sector) => ClaimsRecord;
  mapHostRegistrySectorToNetworkName: (hostSector?: string) => NetworkName;
  extractResources: (claims: ClaimsRecord, environment?: string) => { organization: any; person?: any; service: any };
  handleServiceAttachment: (service?: any) => Promise<any>;
  finalizeTenantConfig: (
    org: any,
    altName: string,
    allClaims: ClaimsRecord,
    sector: Sector,
    vaultId: string,
    options?: {
      primaryDid?: string;
      publicTenantUrl?: string;
      governanceVc?: VerifiableCredentialV2;
      networkName?: NetworkName;
      controllerDid?: string;
      controllerDidDocument?: DidDocument;
    },
  ) => Promise<OrganizationConfig>;
  getCurrentUrnNetwork: () => string;
  buildControllerEntityConfig: (
    legalRep: any,
    tenantUrn: string,
    hostedTenantDid: string,
    vaultId: string,
    registrationKeys?: { signerJwk?: PublicJwk; encrypterJwk?: PublicJwk },
    explicitBinding?: ActivationParticipantMaterial,
  ) => Promise<EntityConfig>;
  extractRegistrationKeys: (jobMeta?: DidCommDecodedMetadata) => { signerJwk?: PublicJwk; encrypterJwk?: PublicJwk };
  storeControllerEntityConfig: (controllerConfig: EntityConfig, tenantCollectionName: string, vaultId: string) => Promise<void>;
  reregisterExistingLegacyRepresentativeController: (input: {
    claims: ClaimsRecord;
    representativeCredential?: Record<string, unknown>;
    environment?: string;
    jobMeta?: DidCommDecodedMetadata;
  }) => Promise<ClaimsRecord | undefined>;
  registerDidDocumentWithIca: (params: {
    vpToken: string;
    presentationSubmission?: any;
    jurisdiction: string;
    sector: string;
    organizationCredential: any;
    representativeCredential: any;
    organizationDidDocument: DidDocument;
    controllerDidDocument: DidDocument;
    organizationBinding?: ActivationParticipantMaterial;
    controllerBinding?: ActivationParticipantMaterial;
  }) => Promise<any | undefined>;
  isLedgerRegistrationEnabled: () => boolean;
  extractServiceEvidence: (service?: any) => any;
}>;

export async function processOrganizationActivation(
  deps: ActivationDeps,
): Promise<IDecodedDidcommPayload> {
  const jobEntries = deps.job?.content?.body?.data || [];
  const responseEntries: (BundleEntry | ErrorEntry)[] = [];
  const body = deps.job?.content?.body as any;

  for (const entry of jobEntries) {
    try {
      const resultEntry = await processActivationEntry({
        ...deps,
        entry,
        body,
        environment: deps.environment,
        jobMeta: deps.job.content?.meta,
        hostRegistrySector: deps.job.sector,
        routeJurisdiction: deps.job.jurisdiction,
      });
      responseEntries.push(resultEntry);
    } catch (error) {
      responseEntries.push(deps.handleError(error, entry?.type || 'Organization', entry?.meta));
    }
  }

  const responseBundle: BundleJsonApi = {
    data: responseEntries,
    resourceType: 'Bundle',
    type: getBundleResponseTypeForAction(deps.job.action),
    total: responseEntries.length,
  };

  return {
    jti: uuidv4(),
    type: 'hosting-response',
    thid: deps.job.content?.thid as string,
    iss: deps.issuerDid,
    aud: deps.job.content?.iss as string,
    exp: Math.floor(Date.now() / 1000) + 300,
    body: responseBundle,
  };
}

async function processActivationEntry(
  deps: ActivationDeps & {
    entry: BundleEntry;
    body: any;
    jobMeta?: DidCommDecodedMetadata;
    hostRegistrySector?: string;
    routeJurisdiction?: string;
  },
): Promise<BundleEntry | ErrorEntry> {
  const activation = await deps.applyDemoRepresentativeBindingFallback(
    deps.extractActivationMaterial(deps.entry, deps.body),
    deps.jobMeta,
  );
  deps.warnOnLegacyActivationCredentialFields(activation);
  if (!activation.vpToken || typeof activation.vpToken !== 'string') {
    throw new ManagerError("Missing required activation proof 'vp_token'.", IssueType.Required);
  }
  const rawClaims = deps.entry?.resource?.meta?.claims;
  const claims = rawClaims ? normalizeContextualizedClaims(rawClaims) : rawClaims;
  if (!claims) {
    throw new ManagerError('Malformed activation entry: missing meta.claims', IssueType.Required);
  }
  const allowLegacyRepresentativeBootstrap = allowsLegacyRepresentativeBootstrap({
    representativeCredential: activation.representativeCredential,
    enabled: process.env.HOST_LEGACY_REPRESENTATIVE_CONTROLLER,
  });
  const trustResult = await deps.activationTrustAdapter.evaluate({
    networkMode: deps.config.networkMode,
    vpToken: activation.vpToken,
    presentationSubmission: activation.presentationSubmission,
    primaryDid: activation.primaryDid,
    organizationCredential: activation.organizationCredential,
    representativeCredential: activation.representativeCredential,
    controllerCredential: activation.controllerCredential,
    jurisdiction: deps.body?.jurisdiction,
    sector: deps.body?.sector,
    allowLegacyRepresentativeBootstrap,
  });
  const clearingResult = trustResult.clearingHouse;
  const { organizationDid } = trustResult;

  const normalizedClaims = deps.backfillOrganizationActivationRouteDefaults(
    deps.applyLegalOrganizationIdentityCompatibility(claims, activation.organizationCredential),
    deps.routeJurisdiction,
  );
  deps.logActivationIdentityDiagnostics('normalized-claims', normalizedClaims, deps.routeJurisdiction);
  validateNewOrganizationClaims(normalizedClaims);
  const alternateName = normalizedClaims[ClaimsOrganizationSchemaorg.alternateName] as string;
  if (!alternateName) {
    throw new ManagerError(`Missing required claim: '${HOST_ACTIVATE_REQUIRED_INPUT_CLAIMS[0]}'`, IssueType.Required);
  }
  if (!isValidTenantAlternateName(alternateName)) {
    throw new ManagerError(`Invalid alternateName format: '${alternateName}'`, IssueType.Value);
  }

  const requestedSector = normalizedClaims[ClaimsServiceSchemaorg.category] as Sector;
  if (!requestedSector) {
    throw new ManagerError(`Missing required claim for activation: '${HOST_ACTIVATE_REQUIRED_INPUT_CLAIMS[1]}'`, IssueType.Required);
  }
  if (requestedSector === 'system') {
    throw new ManagerError("The 'system' sector is a reserved keyword and cannot be used by tenants.", IssueType.Forbidden);
  }
  if (!deps.config.sectorsAllowed.includes(requestedSector)) {
    throw new ManagerError(`The requested sector '${requestedSector}' is not supported by this gateway.`, IssueType.Value);
  }

  const requestedServiceTypes = parseServiceCapabilityTokens(normalizedClaims[ClaimsServiceSchemaorg.serviceType]);
  const serviceAuthorizationErrors = validateActivationServiceAuthorizationPolicy({
    organizationCredential: activation.organizationCredential,
    requiredCategory: requestedSector,
    requiredServiceTypes: requestedServiceTypes,
  });
  if (serviceAuthorizationErrors.length > 0) {
    const first = serviceAuthorizationErrors[0];
    throw new ManagerError(first.message, first.code.startsWith('UNAUTHORIZED_') ? IssueType.Conflict : IssueType.Required);
  }

  const vaultId = getTenantVaultId(requestedSector, alternateName);
  if (await deps.vaultRepository.vaultExists(vaultId)) {
    const reRegisteredClaims = await deps.reregisterExistingLegacyRepresentativeController({
      claims: normalizedClaims,
      representativeCredential: activation.representativeCredential,
      environment: deps.environment,
      jobMeta: deps.jobMeta,
    });
    if (reRegisteredClaims) {
      return {
        type: GatewayResponseEntryTypes.OrganizationActivation,
        resource: { resourceType: ResourceTypesFhirR4.Organization, id: alternateName, meta: { claims: {
          ...reRegisteredClaims,
          [GatewayClaim.ClearingHouseAcr]: clearingResult.acr,
          [GatewayClaim.ClearingHouseLedgerVerified]: String(clearingResult.ledgerVerified),
          [GatewayClaim.ActivationNetworkMode]: trustResult.trustPolicy.networkMode,
          [GatewayClaim.ActivationRevocationChecked]: String(trustResult.trustPolicy.revocationChecked),
          [GatewayClaim.ActivationOnChainChecked]: String(trustResult.trustPolicy.onChainChecked),
        } } },
        response: { status: '200' },
      };
    }
    throw new ManagerError(`Conflict: a vault for '${vaultId}' already exists`, IssueType.Conflict);
  }

  const { organization, person, service } = deps.extractResources(normalizedClaims, deps.environment);
  const processedService = await deps.handleServiceAttachment(service);
  const processedClaims = deps.backfillOrganizationActivationRouteDefaults(
    { ...normalizedClaims, ...(processedService?.meta?.claims || {}) },
    deps.routeJurisdiction,
  );
  deps.logActivationIdentityDiagnostics('processed-claims', processedClaims, deps.routeJurisdiction);
  const normalizedPublicUrl = deps.normalizeTenantPublicUrl(
    activation.publicTenantUrl || (processedClaims[ClaimsOrganizationSchemaorg.url] as string | undefined),
  );
  if (normalizedPublicUrl) (processedClaims as any)[ClaimsOrganizationSchemaorg.url] = normalizedPublicUrl;
  if (!String(processedClaims[ClaimsOrganizationSchemaorg.addressCountry] || '').trim()) {
    const fallbackCountry = String(deps.config.host.jurisdiction || '').trim();
    if (fallbackCountry) (processedClaims as any)[ClaimsOrganizationSchemaorg.addressCountry] = fallbackCountry;
  }
  if (!String(processedClaims[ClaimsOrganizationSchemaorg.addressCountry] || '').trim()) {
    throw new ManagerError(`Missing required claim for activation: '${HOST_ACTIVATE_REQUIRED_INPUT_CLAIMS[2]}'`, IssueType.Required);
  }
  if (!(processedClaims as any)[ClaimsOrganizationSchemaorg.identifier]) {
    (processedClaims as any)[ClaimsOrganizationSchemaorg.identifier] = deps.createOrganizationUrnSafely(processedClaims, requestedSector);
  }
  Object.assign(
    processedClaims,
    deps.withHostedOrganizationOfferClaims(
      processedClaims,
      requestedSector,
    ),
  );
  if (!String(processedClaims[HOST_ACTIVATE_REQUIRED_OUTPUT_CLAIMS[0]] || '').trim()) {
    throw new ManagerError(
      `Missing required generated claim for activation: '${HOST_ACTIVATE_REQUIRED_OUTPUT_CLAIMS[0]}'`,
      IssueType.Required,
    );
  }

  const tenantCollectionName = generateTenantCollectionNameFromClaims(processedClaims);
  await deps.vaultRepository.createNewVault({ id: tenantCollectionName });
  await deps.kmsService.provisionKeys(vaultId);

  const tenantUrn = createOrganizationUrn({
    namespace: deps.config.namespace,
    network: deps.getCurrentUrnNetwork(),
    jurisdiction: processedClaims[ClaimsOrganizationSchemaorg.addressCountry] as string,
    sector: requestedSector,
    idType: processedClaims[ClaimsOrganizationSchemaorg.identifierType] as string,
    idValue: processedClaims[ClaimsOrganizationSchemaorg.identifierValue] as string,
  });
  const hostedTenantDid = createHostedDidWeb(
    composeHostDidWebId(deps.config.apiBaseUrl, deps.config.hostExternalDomain),
    alternateName,
    {
      jurisdiction: processedClaims[ClaimsOrganizationSchemaorg.addressCountry] as string,
      version: 'v1',
      sector: requestedSector,
    },
  );
  const controllerConfig = await deps.buildControllerEntityConfig(
    person,
    tenantUrn,
    hostedTenantDid,
    vaultId,
    deps.extractRegistrationKeys(deps.jobMeta),
    activation.controllerBinding,
  );

  const finalTenantConfig = await deps.finalizeTenantConfig(
    organization,
    alternateName,
    processedClaims,
    requestedSector,
    vaultId,
    {
      networkName: deps.mapHostRegistrySectorToNetworkName(deps.hostRegistrySector),
      primaryDid: organizationDid,
      publicTenantUrl: normalizedPublicUrl,
      governanceVc: activation.organizationCredential as VerifiableCredentialV2 | undefined,
      controllerDid: controllerConfig.didDocument?.id,
      controllerDidDocument: controllerConfig.didDocument,
    },
  );
  if (activation.representativeCredential || activation.vpToken) {
    finalTenantConfig.verifiablePresentation = {
      vp_token: activation.vpToken,
      presentation_submission: activation.presentationSubmission,
      representativeCredential: activation.representativeCredential,
      clearingHouse: clearingResult,
      trustPolicy: trustResult.trustPolicy,
    };
  }

  const tenantRegistrationDoc: ConfidentialStorageDoc & { meta?: Record<string, unknown> } = {
    id: vaultId,
    status: finalTenantConfig.status,
    sequence: 0,
    meta: { claims: processedClaims },
    indexed: {
      attributes: [
        ...buildOfferOrderIndexedAttributes(processedClaims),
      ],
      hmac: { id: 'urn:unsupported', type: 'Sha256HmacKey2019' },
    },
    content: finalTenantConfig,
  };

  const hostCollectionName = deps.hostRuntime.hostCollectionName;
  if (!hostCollectionName) {
    throw new ManagerError('Host collection not found in cache.', IssueType.NotFound);
  }
  const secureTenantRegistrationDoc = await deps.kmsService.protectConfidentialData(tenantRegistrationDoc, 'host');
  await deps.vaultRepository.put(hostCollectionName, [secureTenantRegistrationDoc], getEnvSectionId('tenants'));

  const legalParticipantDoc: ConfidentialStorageDoc = { id: 'legal-participant.vc.json', status: 'active', sequence: 0, content: finalTenantConfig.governanceVc };
  const legacyVcDoc: ConfidentialStorageDoc = { id: 'vc.json', status: 'active', sequence: 0, content: finalTenantConfig.governanceVc };
  const selfDescDoc: ConfidentialStorageDoc = { id: 'self-description.json', status: 'active', sequence: 0, content: finalTenantConfig.selfDescriptionVc };
  const secureLegalParticipantDoc = await deps.kmsService.protectConfidentialData(legalParticipantDoc, vaultId);
  const secureLegacyVcDoc = await deps.kmsService.protectConfidentialData(legacyVcDoc, vaultId);
  const secureSelfDescDoc = await deps.kmsService.protectConfidentialData(selfDescDoc, vaultId);
  await deps.vaultRepository.put(tenantCollectionName, [secureLegalParticipantDoc, secureLegacyVcDoc, secureSelfDescDoc], getEnvSectionId('.well-known'));

  await deps.storeControllerEntityConfig(controllerConfig, tenantCollectionName, vaultId);
  const icaDidRegistration = await deps.registerDidDocumentWithIca({
    vpToken: activation.vpToken,
    presentationSubmission: activation.presentationSubmission,
    jurisdiction: processedClaims[ClaimsOrganizationSchemaorg.addressCountry] as string,
    sector: requestedSector,
    organizationCredential: activation.organizationCredential,
    representativeCredential: activation.representativeCredential,
    organizationDidDocument: finalTenantConfig.didDocument!,
    controllerDidDocument: controllerConfig.didDocument!,
    organizationBinding: activation.organizationBinding,
    controllerBinding: activation.controllerBinding,
  });

  if (processedService) {
    const serviceDoc: ConfidentialStorageDoc = { id: processedService.id, status: 'active', sequence: 0, content: processedService };
    const secureServiceDoc = await deps.kmsService.protectConfidentialData(serviceDoc, vaultId);
    await deps.vaultRepository.put(tenantCollectionName, [secureServiceDoc], getEnvSectionId('services'));
  }

  if (activation.representativeCredential || activation.vpToken || activation.organizationCredential) {
    const activationProofDoc: ConfidentialStorageDoc = {
      id: 'activation-proof.json',
      status: 'active',
      sequence: 0,
      content: {
        vp_token: activation.vpToken,
        presentation_submission: activation.presentationSubmission,
        clearingHouse: clearingResult,
        trustPolicy: trustResult.trustPolicy,
        organizationCredential: activation.organizationCredential,
        representativeCredential: activation.representativeCredential,
        icaDidRegistration,
      },
    };
    const secureActivationProofDoc = await deps.kmsService.protectConfidentialData(activationProofDoc, vaultId);
    await deps.vaultRepository.put(tenantCollectionName, [secureActivationProofDoc], getEnvSectionId('proofs'));
  }

  if (deps.isLedgerRegistrationEnabled()) {
    const serviceEvidence = deps.extractServiceEvidence(processedService);
    await registerOrganizationOnLedger({
      ledgerConfig: deps.config.ledger,
      hostJurisdiction: deps.config.host.jurisdiction,
      namespace: deps.config.namespace,
      hostExternalDomain: deps.config.hostExternalDomain,
      logger: deps.logger,
      orgId: (processedClaims as any)[ClaimsOrganizationSchemaorg.identifier] || tenantUrn,
      organization,
      config: finalTenantConfig,
      evidence: serviceEvidence,
      role: 'tenant',
      sector: requestedSector,
      jurisdiction: processedClaims[ClaimsOrganizationSchemaorg.addressCountry] as string,
    });
  }

  return {
    type: GatewayResponseEntryTypes.OrganizationActivation,
    resource: { resourceType: ResourceTypesFhirR4.Organization, id: organization.id, meta: {
      claims: {
        ...processedClaims,
        [GatewayClaim.OrganizationDid]: finalTenantConfig.didDocument?.id,
        [GatewayClaim.ClearingHouseAcr]: clearingResult.acr,
        [GatewayClaim.ClearingHouseLedgerVerified]: String(clearingResult.ledgerVerified),
        [GatewayClaim.ActivationNetworkMode]: trustResult.trustPolicy.networkMode,
        [GatewayClaim.ActivationRevocationChecked]: String(trustResult.trustPolicy.revocationChecked),
        [GatewayClaim.ActivationOnChainChecked]: String(trustResult.trustPolicy.onChainChecked),
      },
    } },
    response: { status: '201' },
  };
}
