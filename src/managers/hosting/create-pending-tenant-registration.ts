import type { DidCommDecodedMetadata } from 'gdc-common-utils-ts/models/confidential-message';
import type { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import {
  ClaimsOfferSchemaorg,
  ClaimsOrganizationSchemaorg,
  ClaimsServiceSchemaorg,
} from 'gdc-common-utils-ts/constants/schemaorg';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { EntityLifecycleStatus } from '../../gdc-backend-utils-node/models/enums';
import type { IServerConfig } from '../../config';
import type { IKmsService } from '../../gdc-backend-utils-node/models/IKmsService';
import type { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import type { IHostRuntime } from '../IHostRuntime';
import { getEnvSectionId } from '../../utils/section-env';
import { getTenantVaultId, isValidTenantAlternateName, resolveOrganizationRouteJurisdiction } from '../../utils/tenant';
import { createOrganizationUrn } from '../../utils/urn';
import type { PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import type { PostalActivationCodeBinding } from 'gdc-common-utils-ts/utils/organization-test-network-credential';
import { isDeepStrictEqual } from 'node:util';
import {
  HOST_TRANSACTION_REQUIRED_INPUT_CLAIMS,
  HOST_TRANSACTION_REQUIRED_OUTPUT_CLAIMS,
} from './hosting-claim-contracts';

type CreatePendingTenantRegistrationDeps = Readonly<{
  claims: ClaimsRecord;
  environment?: string;
  jobMeta?: DidCommDecodedMetadata;
  fallbackAlternateName?: string;
  primaryDid?: string;
  registrationControllerDid?: string;
  postalActivationCodeBinding?: PostalActivationCodeBinding;
  config: IServerConfig;
  vaultRepository: IVaultRepository;
  kmsService: IKmsService;
  hostRuntime: IHostRuntime;
  applyLegalOrganizationIdentityCompatibility: (claims: ClaimsRecord) => ClaimsRecord;
  extractResources: (claims: ClaimsRecord, environment?: string) => { organization: any; person?: any; service: any };
  handleServiceAttachment: (service: any) => Promise<any>;
  withHostedOrganizationOfferClaims: (
    claims: ClaimsRecord,
    requestedSector: Sector,
  ) => ClaimsRecord;
  extractRegistrationKeys: (
    meta?: DidCommDecodedMetadata,
  ) => { signerJwk?: PublicJwk; encrypterJwk?: PublicJwk };
  getCurrentUrnNetwork: () => string;
}>;

/**
 * Shared pending-registration builder for host onboarding.
 *
 * Contract:
 * - `_transaction` must fail if the tenant `alternateName` or requested sector
 *   category is absent
 * - the returned `processedClaims` must already contain the canonical
 *   `org.schema.Offer.identifier` consumed later by `Order/_batch`
 * - the persisted host-side doc must be indexed by that Offer id so the Order
 *   flow can resolve the pending tenant deterministically
 */
export async function createPendingTenantRegistration(
  deps: CreatePendingTenantRegistrationDeps,
): Promise<ClaimsRecord> {
  const normalizedClaims = deps.applyLegalOrganizationIdentityCompatibility(deps.claims);
  const alternateName = String(
    normalizedClaims[ClaimsOrganizationSchemaorg.alternateName]
    || deps.fallbackAlternateName
    || '',
  ).trim();
  const enrichedClaims: ClaimsRecord = {
    ...normalizedClaims,
    ...(alternateName ? { [ClaimsOrganizationSchemaorg.alternateName]: alternateName } : {}),
  };

  if (!alternateName) {
    throw new ManagerError(`Missing required claim: '${HOST_TRANSACTION_REQUIRED_INPUT_CLAIMS[0]}'`, IssueType.Required);
  }
  if (!isValidTenantAlternateName(alternateName)) {
    throw new ManagerError(`Invalid alternateName format: '${alternateName}'`, IssueType.Value);
  }

  const requestedSector = enrichedClaims[ClaimsServiceSchemaorg.category] as Sector;
  if (!requestedSector) {
    throw new ManagerError(`Missing required claim for new tenant: '${HOST_TRANSACTION_REQUIRED_INPUT_CLAIMS[1]}'`, IssueType.Required);
  }
  if (requestedSector === Sector.SYSTEM) {
    throw new ManagerError("The 'system' sector is a reserved keyword and cannot be used by tenants.", IssueType.Forbidden);
  }
  if (!deps.config.sectorsAllowed.includes(requestedSector)) {
    throw new ManagerError(`The requested sector '${requestedSector}' is not supported by this gateway.`, IssueType.Value);
  }

  const vaultId = getTenantVaultId(requestedSector, alternateName);
  const hostCollectionName = deps.hostRuntime.hostCollectionName;
  const registrationKeys = deps.extractRegistrationKeys(deps.jobMeta);
  const registrationControllerDid = String(deps.registrationControllerDid || '').trim();
  const existingDoc = await deps.vaultRepository.get<ConfidentialStorageDoc>(
    hostCollectionName!,
    vaultId,
    getEnvSectionId('tenants'),
  );
  if (existingDoc) {
    const existingContent = await deps.kmsService.unprotectConfidentialData<any>(existingDoc, 'host');
    if (existingContent?.status !== EntityLifecycleStatus.Pending) {
      throw new ManagerError(`Conflict: a vault for '${vaultId}' already exists`, IssueType.Conflict);
    }

    const existingClaims = existingContent.claims as ClaimsRecord | undefined;
    const stableClaimNames = [
      ClaimsOrganizationSchemaorg.alternateName,
      ClaimsOrganizationSchemaorg.identifierType,
      ClaimsOrganizationSchemaorg.identifierValue,
      ClaimsOrganizationSchemaorg.addressCountry,
      ClaimsOrganizationSchemaorg.addressRegion,
      ClaimsOrganizationSchemaorg.legalName,
      ClaimsServiceSchemaorg.category,
    ];
    const identityMatches = existingClaims && stableClaimNames.every((claimName) => (
      isDeepStrictEqual(existingClaims[claimName], enrichedClaims[claimName])
    ));
    if (!identityMatches) {
      throw new ManagerError('Pending registration replay does not match the existing organization identity.', IssueType.Conflict);
    }

    const existingControllerDid = String(existingContent.registrationControllerDid || '').trim();
    const existingKeys = existingContent.registrationKeys as
      | { signerJwk?: PublicJwk; encrypterJwk?: PublicJwk }
      | undefined;
    if (existingControllerDid && registrationControllerDid && existingControllerDid !== registrationControllerDid) {
      throw new ManagerError('Pending registration replay controller DID does not match.', IssueType.Security);
    }
    if (existingKeys && (
      (registrationKeys.signerJwk && !isDeepStrictEqual(existingKeys.signerJwk, registrationKeys.signerJwk))
      || (registrationKeys.encrypterJwk && !isDeepStrictEqual(existingKeys.encrypterJwk, registrationKeys.encrypterJwk))
    )) {
      throw new ManagerError('Pending registration replay communication keys do not match.', IssueType.Security);
    }

    if (!existingKeys && registrationControllerDid && registrationKeys.signerJwk && registrationKeys.encrypterJwk) {
      const resumedDoc: ConfidentialStorageDoc = {
        ...existingDoc,
        status: EntityLifecycleStatus.Pending,
        sequence: Number(existingDoc.sequence || 0) + 1,
        content: {
          ...existingContent,
          registrationControllerDid,
          registrationKeys,
        },
      };
      const secureResumedDoc = await deps.kmsService.protectConfidentialData(resumedDoc, 'host');
      await deps.vaultRepository.put(hostCollectionName!, [secureResumedDoc], getEnvSectionId('tenants'));
    }
    return existingClaims!;
  }
  if (await deps.vaultRepository.vaultExists(vaultId)) {
    throw new ManagerError(`Conflict: a vault for '${vaultId}' already exists`, IssueType.Conflict);
  }

  const { organization, person, service } = deps.extractResources(enrichedClaims, deps.environment);
  const processedService = await deps.handleServiceAttachment(service);
  let processedClaims: ClaimsRecord = { ...enrichedClaims, ...(processedService?.meta?.claims || {}) };

  const jurisdiction = resolveOrganizationRouteJurisdiction(processedClaims);
  const isIndividualOrg = !!(
    processedClaims['org.schema.Organization.owner.telephone']
    || processedClaims['org.schema.Organization.owner.email']
  );
  if (!isIndividualOrg) {
    (processedClaims as any)[ClaimsOrganizationSchemaorg.identifier] = createOrganizationUrn({
      namespace: deps.config.namespace,
      network: deps.getCurrentUrnNetwork(),
      jurisdiction,
      sector: requestedSector,
      idType: processedClaims[ClaimsOrganizationSchemaorg.identifierType] as string,
      idValue: processedClaims[ClaimsOrganizationSchemaorg.identifierValue] as string,
    });
  } else {
    (processedClaims as any)[ClaimsOrganizationSchemaorg.identifier] = alternateName || organization.id;
  }

  processedClaims = deps.withHostedOrganizationOfferClaims(
    processedClaims,
    requestedSector,
  );
  if (!String(processedClaims[HOST_TRANSACTION_REQUIRED_OUTPUT_CLAIMS[0]] || '').trim()) {
    throw new ManagerError(
      `Missing required generated claim for host transaction: '${HOST_TRANSACTION_REQUIRED_OUTPUT_CLAIMS[0]}'`,
      IssueType.Required,
    );
  }

  const tenantRegistrationDoc: ConfidentialStorageDoc = {
    id: vaultId,
    status: EntityLifecycleStatus.Pending,
    sequence: 0,
    indexed: {
      attributes: [
        { name: 'status', value: EntityLifecycleStatus.Pending },
        { name: ClaimsOfferSchemaorg.identifier, value: processedClaims[ClaimsOfferSchemaorg.identifier] as string, unique: true },
      ],
      hmac: { id: 'urn:unsupported', type: 'Sha256HmacKey2019' },
    },
    content: {
      status: EntityLifecycleStatus.Pending,
      claims: processedClaims,
      contained: [person, processedService].filter(Boolean),
      ...(deps.primaryDid ? { primaryDid: deps.primaryDid } : {}),
      ...(deps.postalActivationCodeBinding ? { postalActivationCodeBinding: deps.postalActivationCodeBinding } : {}),
      ...(registrationKeys.signerJwk || registrationKeys.encrypterJwk ? { registrationKeys } : {}),
      ...(registrationControllerDid && (registrationKeys.signerJwk || registrationKeys.encrypterJwk)
        ? { registrationControllerDid }
        : {}),
    },
  };

  const secureTenantRegistrationDoc = await deps.kmsService.protectConfidentialData(tenantRegistrationDoc, 'host');
  await deps.vaultRepository.put(hostCollectionName!, [secureTenantRegistrationDoc], getEnvSectionId('tenants'));
  return processedClaims;
}
