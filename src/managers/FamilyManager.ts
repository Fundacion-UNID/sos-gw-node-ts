// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/FamilyManager.ts
import { createHash } from 'crypto';
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';
import { HealthcareActorRoleCodes } from 'gdc-common-utils-ts/constants/healthcare';
import { HL7_CODING_SYSTEM_V3_ROLE_CODE } from 'gdc-common-utils-ts/constants/hl7-roles';
import { SecureIdTypesIndividual } from 'gdc-common-utils-ts/constants/identity-identifiers';
import {
  buildSecureIdValueIndividual,
} from 'gdc-common-utils-ts/utils/did';

import { v4 as uuidv4 } from 'uuid';
import { IServerConfig } from '../config';
import { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { IStorageAdapter } from '../database/storage/IStorageAdapter';
import { ILogger } from '../loggers/ILogger';
import { BundleEntry, BundleJsonApi, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { IncludedResource } from 'gdc-common-utils-ts/models/jsonapi';
import { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import { ClaimsIndividualProductSchemaorg, ClaimsOfferSchemaorg, ClaimsOrderSchemaorg, ClaimsOrganizationSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { buildStableActorIdentifier, StableActorContactKinds } from 'gdc-common-utils-ts/utils/actor-identifier';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { getBundleResponseTypeForAction } from '../utils/bundle';
import { getClaimValue, normalizeContextualizedClaims } from '../utils/claims';
import { formatMissingRequiredClaimDiagnostic, toExternalClaimLabel } from '../utils/claim-contract';
import {
  buildOfferOrderIndexedAttributes,
  buildOfferOrderSearchRow,
  extractOfferOrderSearchClaims,
  matchOfferOrderSearchClaims,
  readProjectedOfferOrderClaims,
} from '../utils/offer-order-read-model';
import { createOperationOutcome } from '../utils/outcome';
import { determineResourceId } from '../utils/resource';
import { getTenantVaultId, getTenantVaultIdFromIss } from '../utils/tenant';
import { generateLicenseOffer } from '../utils/offer';
import { getEnvSectionId } from '../utils/section-env';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { normalizeUuid } from 'gdc-common-utils-ts/utils/normalize-uuid';
import { EntityLifecycleStatus } from '../gdc-backend-utils-node/models/enums';
import type { ITenantsManager } from './ITenantsManager';
import { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import { issueActivationCodeFromPool, materializeFreeIndividualLicenses } from '../utils/license-issuance';
import { buildPaymentCommunication, readOfferPaymentContext } from '../utils/order-communication';
import { buildGatewayInvoiceBundle } from '../utils/invoice-bundle';
import { verifyOrderPaymentConfirmation } from '../utils/payment-confirmation';
import { buildClaimsFromIndividualRegistrationPdfAttachment } from '../utils/individual-registration-pdf-attachment';
import { buildClaimsFromIndividualOrganizationKyc } from '../utils/individual-organization-kyc';
import { buildIndividualOnboardingPdfDraftResponse } from '../utils/individual-onboarding-pdf-draft';
import { normalizeIndexedEmail, normalizeIndexedPhone, splitIndexedEmails, splitIndexedPhones } from '../utils/indexed-contact';
import { getAuthenticatedJobActorIdentifiers } from '../utils/authenticated-job-actor';
import {
  ACTION_DISABLE,
  ACTION_PURGE,
  LICENSE_CATEGORY_INDIVIDUAL,
  LICENSE_STATUS_ACTIVE,
  LICENSE_STATUS_AVAILABLE,
  LICENSE_STATUS_ISSUED,
  LICENSE_TYPE_MOBILE,
  LICENSE_USER_CLASS_CUSTOMER,
  LICENSE_USER_CLASS_INDIVIDUAL,
  SUBJECT_SECTION_INDIVIDUAL,
} from '../constants/domain';
import { buildSearchResponseEntries } from '../utils/didcomm-response';
import { GatewayResponseEntryTypes } from '../shared/gateway-response-types';
import { AnimalIndividualRegistration, GatewayClaim, FamilyRegistrationStatus } from '../shared/gateway-claim-contract';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { Format } from 'gdc-common-utils-ts/constants/Schemas';
import { RelatedPersonClaim } from 'gdc-common-utils-ts/models/interoperable-claims/related-person-claims';
import { getSubjectScopedSectionId } from '../utils/individual-sections';
import { validateFhirPayloadByVersion } from '../utils/fhir-ingestion';
import { REGISTERED_PROFILE_ACCOUNT_DIRECTORY_META } from '../utils/secure-route-bearer-binding';

type FamilyRegistrationContent = {
  status: EntityLifecycleStatus;
  claims: ClaimsRecord;
  contained: IncludedResource[];
};

const INDIVIDUAL_SECTION = getEnvSectionId(SUBJECT_SECTION_INDIVIDUAL);
const DEVICE_LICENSE_SECTION = getEnvSectionId('device-licenses');
const TENANT_DISABLED_HOSTED_INDIVIDUAL_MESSAGE =
  'Tenant disabled must not allow creating a new hosted individual.';
const ANIMAL_SUBJECT_KIND = AnimalIndividualRegistration.SubjectKind;
const INDIVIDUAL_SELF_ROLE = AnimalIndividualRegistration.SelfRole;
const NCBI_TAXONOMY_URI_PATTERN = /^http:\/\/purl\.obolibrary\.org\/obo\/NCBITaxon_[1-9]\d*$/;

/**
 * Reads the VetChain-only activation boundary without changing generic GW
 * family semantics. The first member is the animal subject itself (`ONESELF`);
 * `Organization.owner` remains the distinct creating controller.
 */
function readAnimalRegistrationReadiness(claims: ClaimsRecord): {
  isAnimal: boolean;
  ready: boolean;
  missing: string[];
} {
  const isAnimal = String(claims[ClaimsOrganizationSchemaorg.additionalType] || '').trim() === ANIMAL_SUBJECT_KIND;
  if (!isAnimal) return { isAnimal: false, ready: true, missing: [] };
  const memberRole = String(claims[ClaimsOrganizationSchemaorg.memberRole] || '').trim();
  if (memberRole && memberRole !== INDIVIDUAL_SELF_ROLE) {
    throw new ManagerError(
      `An animal Individual Organization must identify its first member as '${INDIVIDUAL_SELF_ROLE}'; controller authority belongs to Organization.owner.`,
      IssueType.Invalid,
    );
  }
  claims[ClaimsOrganizationSchemaorg.memberRole] = INDIVIDUAL_SELF_ROLE;
  const missing: string[] = [];
  if (!String(claims[ClaimsOrganizationSchemaorg.alternateName] || '').trim()) missing.push('alternateName');
  if (!NCBI_TAXONOMY_URI_PATTERN.test(String(claims[ClaimsOrganizationSchemaorg.memberAdditionalType] || '').trim())) missing.push('species');
  if (!String(claims[ClaimsOrganizationSchemaorg.sameAs] || '').trim()) missing.push('card');
  return { isAnimal: true, ready: missing.length === 0, missing };
}

type IndividualRegistrationReadiness = Readonly<{
  profile: 'human' | 'veterinary';
  isDraft: boolean;
  ready: boolean;
  missing: string[];
}>;

/** Applies the human-card boundary without weakening the veterinary profile. */
function readHumanRegistrationReadiness(claims: ClaimsRecord): IndividualRegistrationReadiness {
  const alternateName = String(claims[ClaimsOrganizationSchemaorg.alternateName] || '').trim();
  const memberRole = String(claims[ClaimsOrganizationSchemaorg.memberRole] || '').trim();
  if (!memberRole && !alternateName) claims[ClaimsOrganizationSchemaorg.memberRole] = INDIVIDUAL_SELF_ROLE;
  const birthDate = String(claims[ClaimsPersonSchemaorg.birthDate] || '').trim();
  const validBirthDate = /^(?:19|20)\d{2}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/u.test(birthDate);
  if (!alternateName && !validBirthDate) {
    throw new ManagerError(
      `Missing required claims: '${ClaimsOrganizationSchemaorg.alternateName}' or a valid '${ClaimsPersonSchemaorg.birthDate}'`,
      IssueType.Required,
    );
  }
  if (!alternateName) {
    claims[ClaimsOrganizationSchemaorg.sameAs] = '';
    delete claims['org.schema.Organization.individualHmacPasskey'];
  }
  const missing = [
    ...(!alternateName ? ['alternateName'] : []),
    ...(!String(claims[ClaimsOrganizationSchemaorg.sameAs] || '').trim() ? ['card'] : []),
  ];
  return { profile: 'human', isDraft: missing.length > 0, ready: missing.length === 0, missing };
}

/** Selects one explicit subject profile and returns its activation boundary. */
function readIndividualRegistrationReadiness(claims: ClaimsRecord): IndividualRegistrationReadiness {
  const animal = readAnimalRegistrationReadiness(claims);
  if (animal.isAnimal) {
    return {
      profile: 'veterinary',
      isDraft: !animal.ready,
      ready: animal.ready,
      missing: animal.missing,
    };
  }
  return readHumanRegistrationReadiness(claims);
}

/** Creates a public card alias only after a human draft has a display name. */
function ensureNamedHumanSubjectCardAlias(claims: ClaimsRecord, documentId: string): void {
  if (String(claims[ClaimsOrganizationSchemaorg.additionalType] || '').trim() === ANIMAL_SUBJECT_KIND) return;
  if (!String(claims[ClaimsOrganizationSchemaorg.alternateName] || '').trim()) return;
  if (String(claims[ClaimsOrganizationSchemaorg.sameAs] || '').trim()) return;
  const providerDid = String(claims[ClaimsOfferSchemaorg.offeredBy] || '').trim();
  if (providerDid) claims[ClaimsOrganizationSchemaorg.sameAs] = buildCanonicalIndividualSubjectDid(providerDid, documentId);
}

export class FamilyManager {
  constructor(
    private vaultRepository: IVaultRepository,
    private kmsService: IKmsService,
    private tenantsCacheManager: ITenantsManager,
    private storageAdapter: IStorageAdapter,
    private logger: ILogger,
    private config: IServerConfig,
  ) {}

  async process(job: JobRequest, environment?: string): Promise<IDecodedDidcommPayload> {
    const jobEntries = job?.content?.body?.data || [];
    const responseEntries: (BundleEntry | ErrorEntry)[] = [];

    try {
      for (const entry of jobEntries) {
        try {
          if (job.action === '_search' && job.resourceType === 'Organization') {
            responseEntries.push(await this.processFamilySearchEntry(job, entry, environment));
          } else if (job.action === '_search' && job.resourceType === 'Offer') {
            responseEntries.push(...await this.processFamilyOfferSearchEntry(job, entry));
          } else if (job.action === '_search' && job.resourceType === 'Order') {
            responseEntries.push(...await this.processFamilyOrderSearchEntry(job, entry));
          } else if (job.action === ACTION_DISABLE && job.resourceType === 'Organization') {
            responseEntries.push(await this.processFamilyDisableEntry(job, entry));
          } else if (job.action === ACTION_PURGE && job.resourceType === 'Organization') {
            responseEntries.push(await this.processFamilyPurgeEntry(job, entry));
          } else if (job.resourceType === 'DocumentReference' || job.resourceType === 'Action') {
            responseEntries.push(await this.processIndividualOnboardingPdfDraftEntry(job, entry));
          } else if (job.resourceType === 'Organization') {
            responseEntries.push(await this.processFamilyRegistrationEntry(job, entry, environment));
          } else if (job.resourceType === 'Order') {
            responseEntries.push(...await this.processFamilyOrderEntry(job, entry, environment));
          } else {
            throw new ManagerError(`Unsupported resourceType for family flow: '${job.resourceType}'`, IssueType.NotSupported);
          }
        } catch (error: any) {
          responseEntries.push(this.handleError(error, entry.type, entry.meta));
        }
      }
    } catch (error: any) {
      const entryType = jobEntries[0]?.type || job.resourceType || 'unknown';
      responseEntries.push(this.handleError(error, entryType));
    }

    const responseBundle: BundleJsonApi = {
      data: responseEntries,
      resourceType: 'Bundle',
      type: getBundleResponseTypeForAction(job.action),
      total: responseEntries.length,
    };

    return {
      jti: uuidv4(),
      type: 'family-response',
      thid: job.content?.thid as string,
      iss: job.content?.aud as string,
      aud: job.content?.iss as string,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: responseBundle,
    };
  }

  /**
   * Rejects hosted individual onboarding when the parent tenant is not
   * operational.
   *
   * Why this guard lives here:
   * - individual section `Organization` jobs are routed to `FamilyManager`, not
   *   `HostingManager`
   * - the live lifecycle contract expects a disabled tenant to reject new
   *   hosted individual creation immediately
   *
   * Why this uses `ITenantsManager` only:
   * - the onboarding flow needs only the derived operational state
   * - it must not load or decrypt the full tenant registration object
   */
  private async assertTenantAllowsHostedIndividualCreation(tenantVaultId: string): Promise<void> {
    const isTenantOperational = await this.tenantsCacheManager.isTenantOperational(tenantVaultId);
    if (!isTenantOperational) {
      throw new ManagerError(TENANT_DISABLED_HOSTED_INDIVIDUAL_MESSAGE, IssueType.Forbidden);
    }
  }

  /** Authorizes contact-scoped individual discovery and lifecycle mutations. */
  private assertOwnerDirectoryAuthorization(
    job: JobRequest,
    tenantVaultId: string,
    ownerPhones: string[],
    ownerEmails: string[],
  ): void {
    const authenticatedIdentifiers = new Set(getAuthenticatedJobActorIdentifiers(job));
    const requestedOwnerIdentifiers = [
      ...ownerEmails.map(email => buildStableActorIdentifier({
        contactKind: StableActorContactKinds.Email,
        contact: email,
      })),
      ...ownerPhones.map(phone => buildStableActorIdentifier({
        contactKind: StableActorContactKinds.Phone,
        contact: phone,
      })),
    ];
    if (requestedOwnerIdentifiers.length === 0) return;
    if (requestedOwnerIdentifiers.some(identifier => authenticatedIdentifiers.has(identifier))) return;

    const actorDid = String(job.content?.iss || '').trim();
    if (actorDid.includes(':employee:') && actorDid.split(':').includes(HealthcareActorRoleCodes.Controller)) {
      try {
        if (getTenantVaultIdFromIss(actorDid) === tenantVaultId) return;
      } catch {
        // Unsupported or cross-tenant DIDs carry no administrative authority.
      }
    }
    throw new ManagerError(
      'Owner directory and individual lifecycle operations require a verified owner contact or the target tenant controller.',
      IssueType.Forbidden,
    );
  }

  private async processFamilyOfferSearchEntry(job: JobRequest, entry: BundleEntry): Promise<BundleEntry[]> {
    const tenantId = job.tenantId;
    const sector = job.sector as Sector | undefined;
    if (!tenantId || !sector) {
      throw new ManagerError('Job is missing tenantId or sector.', IssueType.Required);
    }
    const tenantVaultId = getTenantVaultId(sector, tenantId);
    const tenantCollectionName = await this.tenantsCacheManager.getCollectionName(tenantVaultId);
    if (!tenantCollectionName) {
      throw new ManagerError(`Tenant not found in cache: '${tenantVaultId}'`, IssueType.NotFound);
    }

    const filters = extractOfferOrderSearchClaims(entry);
    const where = Object.entries(filters)
      .filter(([key, value]) => !key.startsWith('@') && value !== undefined && value !== null && String(value).trim() !== '')
      .map(([name, value]) => ({ name, value: String(value).trim() }));
    const records = where.length > 0
      ? [
        ...await this.vaultRepository.query(tenantCollectionName, { sectionId: INDIVIDUAL_SECTION, where }, { hydrate: false }),
        ...await this.vaultRepository.query(tenantCollectionName, { sectionId: getEnvSectionId('communications'), where }, { hydrate: false }),
      ]
      : [
        ...await this.vaultRepository.listContainersInSection(tenantCollectionName, INDIVIDUAL_SECTION),
        ...await this.vaultRepository.listContainersInSection(tenantCollectionName, getEnvSectionId('communications')),
      ];
    const matches: Record<string, unknown>[] = [];
    for (const secureDoc of records as ConfidentialStorageDoc[]) {
      const claims = readProjectedOfferOrderClaims(secureDoc);
      if (!claims[ClaimsOfferSchemaorg.identifier]) continue;
      if (!matchOfferOrderSearchClaims(claims, filters)) continue;
      matches.push(buildOfferOrderSearchRow(
        secureDoc,
        claims,
        ClaimsOfferSchemaorg.identifier,
      ));
    }

    return buildSearchResponseEntries(GatewayResponseEntryTypes.OfferSearch, matches);
  }

  private async processFamilyOrderSearchEntry(job: JobRequest, entry: BundleEntry): Promise<BundleEntry[]> {
    const tenantId = job.tenantId;
    const sector = job.sector as Sector | undefined;
    if (!tenantId || !sector) {
      throw new ManagerError('Job is missing tenantId or sector.', IssueType.Required);
    }
    const tenantVaultId = getTenantVaultId(sector, tenantId);
    const tenantCollectionName = await this.tenantsCacheManager.getCollectionName(tenantVaultId);
    if (!tenantCollectionName) {
      throw new ManagerError(`Tenant not found in cache: '${tenantVaultId}'`, IssueType.NotFound);
    }

    const filters = extractOfferOrderSearchClaims(entry);
    const where = Object.entries(filters)
      .filter(([key, value]) => !key.startsWith('@') && value !== undefined && value !== null && String(value).trim() !== '')
      .map(([name, value]) => ({ name, value: String(value).trim() }));
    const records = where.length > 0
      ? await this.vaultRepository.query(
        tenantCollectionName,
        { sectionId: getEnvSectionId('communications'), where },
        { hydrate: false },
      )
      : await this.vaultRepository.listContainersInSection(tenantCollectionName, getEnvSectionId('communications'));
    const matches: Record<string, unknown>[] = [];
    for (const secureDoc of records as ConfidentialStorageDoc[]) {
      const claims = readProjectedOfferOrderClaims(secureDoc);
      if (!claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier]) continue;
      if (!matchOfferOrderSearchClaims(claims, filters)) continue;
      matches.push(buildOfferOrderSearchRow(
        secureDoc,
        claims,
        ClaimsOrderSchemaorg.acceptedOfferIdentifier,
      ));
    }

    return buildSearchResponseEntries(GatewayResponseEntryTypes.OrderSearch, matches);
  }

  private async processFamilyRegistrationEntry(job: JobRequest, entry: BundleEntry, environment?: string): Promise<BundleEntry | ErrorEntry> {
    const entryType = entry.type || 'Family-registration-form-v1.0';
    const rawClaims = entry?.resource?.meta?.claims;
    const rawClaimsObject = (rawClaims && typeof rawClaims === 'object') ? rawClaims as Record<string, unknown> : {};
    const normalizedRawClaims: ClaimsRecord | undefined = Object.keys(rawClaimsObject).length > 0
      ? (normalizeContextualizedClaims(rawClaimsObject) as ClaimsRecord)
      : undefined;
    const attachmentClaims = await this.resolveIndividualRegistrationAttachmentClaims(job);
    const kycClaims = this.resolveIndividualRegistrationKycClaims(entry, normalizedRawClaims, attachmentClaims);
    const mergedClaims = {
      ...rawClaimsObject,
      ...(kycClaims || {}),
      ...(attachmentClaims || {}),
    };
    const claims: ClaimsRecord | undefined = Object.keys(mergedClaims).length > 0
      ? (normalizeContextualizedClaims(mergedClaims) as ClaimsRecord)
      : undefined;
    if (!claims) {
      throw new ManagerError('Malformed entry: missing meta.claims', IssueType.Required);
    }

    const requestedSector = claims[ClaimsServiceSchemaorg.category] as Sector | undefined;
    if (!requestedSector) {
      throw new ManagerError(`Missing required claim: '${ClaimsServiceSchemaorg.category}'`, IssueType.Required);
    }

    const tenantId = job.tenantId;
    if (!tenantId) {
      throw new ManagerError('Job is missing tenantId.', IssueType.Required);
    }

    const tenantVaultId = getTenantVaultId(requestedSector, tenantId);
    const tenantCollectionName = await this.tenantsCacheManager.getCollectionName(tenantVaultId);
    if (!tenantCollectionName) {
      throw new ManagerError(`Tenant not found in cache: '${tenantVaultId}'`, IssueType.NotFound);
    }
    await this.assertTenantAllowsHostedIndividualCreation(tenantVaultId);

    const { organization, person, service } = this.extractResources(claims, environment);
    const processedService = await this.handleServiceAttachment(service);

    // Individual org attributes live in Organization claims.
    const ownerPhones = splitIndexedPhones(claims['org.schema.Organization.owner.telephone'] as string | undefined);
    const ownerEmails = splitIndexedEmails(claims['org.schema.Organization.owner.email'] as string | undefined);
    readIndividualRegistrationReadiness(claims);
    const apodo = String(claims[ClaimsOrganizationSchemaorg.alternateName] || '').trim();
    if (ownerPhones.length === 0 && ownerEmails.length === 0) {
      throw new ManagerError(
        'Missing required claims: one of owner.telephone/owner.email',
        IssueType.Required,
      );
    }

    const requestedDocumentId = normalizeUuid(claims[ClaimsOrganizationSchemaorg.identifierValue]);
    const existingById = requestedDocumentId
      ? await this.vaultRepository.get<ConfidentialStorageDoc>(tenantCollectionName, requestedDocumentId, INDIVIDUAL_SECTION)
      : undefined;
    if (existingById) {
      const existingContent = await this.kmsService.unprotectConfidentialData<FamilyRegistrationContent>(existingById, tenantVaultId);
      const storedPhones = splitIndexedPhones(existingContent.claims[ClaimsOrganizationSchemaorg.ownerTelephone] as string | undefined);
      const storedEmails = splitIndexedEmails(existingContent.claims[ClaimsOrganizationSchemaorg.ownerEmail] as string | undefined);
      const ownsDraft = ownerPhones.some(value => storedPhones.includes(value)) || ownerEmails.some(value => storedEmails.includes(value));
      if (!ownsDraft) throw new ManagerError('Only the verified owner/controller may resume this individual draft.', IssueType.Forbidden);
      if (existingContent.status === EntityLifecycleStatus.Active) {
        return {
          type: 'Family-registration-offer-v1.0',
          resource: { resourceType: ResourceTypesFhirR4.Organization, id: existingById.id, meta: { claims: {
            ...existingContent.claims,
            [GatewayClaim.FamilyRegistrationStatus]: FamilyRegistrationStatus.Existing,
          } } },
          response: { status: '200' },
        };
      }
      if (existingContent.status !== EntityLifecycleStatus.Pending) {
        throw new ManagerError('Only a pending individual registration may be resumed by identifier.', IssueType.Conflict);
      }
      const nonEmptyRequestedClaims = Object.fromEntries(Object.entries(claims).filter(([, value]) => String(value ?? '').trim() !== ''));
      const resumedClaims = { ...existingContent.claims, ...nonEmptyRequestedClaims } as ClaimsRecord;
      ensureNamedHumanSubjectCardAlias(resumedClaims, existingById.id);
      const resumedReadiness = readIndividualRegistrationReadiness(resumedClaims);
      const resumedContent: FamilyRegistrationContent = { ...existingContent, claims: resumedClaims };
      const resumedDocument: ConfidentialStorageDoc & { meta?: Record<string, unknown> } = {
        ...existingById,
        sequence: Number(existingById.sequence || 0) + 1,
        meta: { claims: resumedClaims },
        content: resumedContent,
      };
      await this.vaultRepository.put(
        tenantCollectionName,
        [await this.kmsService.protectConfidentialData(resumedDocument, tenantVaultId)],
        INDIVIDUAL_SECTION,
      );
      return {
        type: 'Family-registration-offer-v1.0',
        resource: { resourceType: ResourceTypesFhirR4.Organization, id: existingById.id, meta: { claims: {
          ...resumedClaims,
          [GatewayClaim.FamilyRegistrationStatus]: resumedReadiness.ready
            ? FamilyRegistrationStatus.ResumeRequired
            : FamilyRegistrationStatus.DraftSaved,
        } } },
        response: { status: '200' },
      };
    }

    // Idempotency: owner+alternateName must be unique.
    for (const phone of apodo ? ownerPhones : []) {
        const existing = await this.vaultRepository.query(tenantCollectionName, {
          sectionId: INDIVIDUAL_SECTION,
          where: [
            { name: 'org.schema.Organization.owner.telephone', value: phone },
            { name: ClaimsOrganizationSchemaorg.alternateName, value: apodo },
          ],
        });
        if (existing.length > 0) {
          const secureExisting = existing[0] as ConfidentialStorageDoc;
          const decryptedContent = await this.kmsService.unprotectConfidentialData<FamilyRegistrationContent>(secureExisting, tenantVaultId);
          const existingContent = await this.repairLegacyFamilyCardIdentity(
            tenantCollectionName,
            tenantVaultId,
            secureExisting,
            decryptedContent,
            claims,
          );
          const regStatus = existingContent?.status === EntityLifecycleStatus.Active ? 'already_exists' : 'resume_required';
          return {
            type: 'Family-registration-offer-v1.0',
            resource: { resourceType: ResourceTypesFhirR4.Organization, id: secureExisting.id, meta: {
              claims: {
                ...(existingContent?.claims || {}),
                [GatewayClaim.FamilyRegistrationStatus]: regStatus,
              },
            } },
            response: { status: '200' },
          };
      }
    }
    for (const email of apodo ? ownerEmails : []) {
      const existing = await this.vaultRepository.query(tenantCollectionName, {
        sectionId: INDIVIDUAL_SECTION,
        where: [
          { name: 'org.schema.Organization.owner.email', value: email },
          { name: ClaimsOrganizationSchemaorg.alternateName, value: apodo },
        ],
      });
      if (existing.length > 0) {
        const secureExisting = existing[0] as ConfidentialStorageDoc;
        const decryptedContent = await this.kmsService.unprotectConfidentialData<FamilyRegistrationContent>(secureExisting, tenantVaultId);
        const existingContent = await this.repairLegacyFamilyCardIdentity(
          tenantCollectionName,
          tenantVaultId,
          secureExisting,
          decryptedContent,
          claims,
        );
        const regStatus = existingContent?.status === EntityLifecycleStatus.Active ? 'already_exists' : 'resume_required';
        return {
          type: 'Family-registration-offer-v1.0',
          resource: { resourceType: ResourceTypesFhirR4.Organization, id: secureExisting.id, meta: {
            claims: {
              ...(existingContent?.claims || {}),
              [GatewayClaim.FamilyRegistrationStatus]: regStatus,
            },
          } },
          response: { status: '200' },
        };
      }
    }

    // Offer generation: default to 2 (representative + subject).
    // This jurisdiction is the data-space/blockchain network selected by the
    // `cds-<jurisdiction>` route. It is not the individual's country and must
    // therefore come from the preserved HTTP route context, not from optional
    // Organization address claims.
    const jurisdiction = String(job.jurisdiction || '').trim();
    if (!jurisdiction) {
      throw new ManagerError('Job is missing route jurisdiction for the individual Offer network.', IssueType.Required);
    }
    const offeredBy = await this.tenantsCacheManager.getTenantDid(tenantVaultId);
    if (!offeredBy) {
      throw new ManagerError(`Tenant DID not found for '${tenantVaultId}'`, IssueType.NotFound);
    }
    const offerClaims = generateLicenseOffer(
      2,
      offeredBy,
      jurisdiction,
      requestedSector,
      this.config.allowedPaymentMethods,
      LICENSE_CATEGORY_INDIVIDUAL,
    );

    const processedClaims: ClaimsRecord = {
      ...claims,
      [ClaimsOrganizationSchemaorg.ownerIdentifierValue]: canonicalControllerUuidOrNew(
        claims[ClaimsOrganizationSchemaorg.ownerIdentifierValue],
      ),
      ...(processedService?.meta.claims || {}),
      ...offerClaims,
      '@type': 'receipt',
    };

    // The storage/document id is private and must always be the canonical UUID
    // from which the public did:web subject alias is derived. Demo placeholders
    // and legacy business identifiers remain claims; they must never leak into
    // the subject-id slot used by controller licences.
    const familyDocId = normalizeUuid(
      processedClaims[ClaimsOrganizationSchemaorg.identifierValue],
    ) || uuidv4();

    const indexedPhones = ownerPhones.map(phone => ({ name: 'org.schema.Organization.owner.telephone', value: phone }));
    const indexedEmails = ownerEmails.map(email => ({ name: 'org.schema.Organization.owner.email', value: email }));
    const indexedSubjectAliases = String(processedClaims[ClaimsOrganizationSchemaorg.sameAs] || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
      .map(value => ({ name: ClaimsOrganizationSchemaorg.sameAs, value }));

    // The public registration response and the persisted individual
    // organization must expose the same canonical identifier. Generating a
    // second fallback UUID here made the member-seat owner impossible for the
    // SDK/portal to address when no official identifier was supplied.
    const individualDocId = familyDocId;
    ensureNamedHumanSubjectCardAlias(processedClaims, individualDocId);
    const finalReadiness = readIndividualRegistrationReadiness(processedClaims);

    const registrationDoc: ConfidentialStorageDoc & { meta?: Record<string, unknown> } = {
      id: individualDocId,
      status: EntityLifecycleStatus.Pending,
      sequence: 0,
      meta: { claims: processedClaims },
      indexed: {
        attributes: [
          { name: 'status', value: EntityLifecycleStatus.Pending },
          { name: ClaimsOfferSchemaorg.identifier, value: processedClaims[ClaimsOfferSchemaorg.identifier] as string, unique: true },
          ...indexedPhones,
          ...indexedEmails,
          ...indexedSubjectAliases,
          ...(requestedDocumentId ? [{ name: ClaimsOrganizationSchemaorg.identifierValue, value: requestedDocumentId, unique: true }] : []),
          ...(apodo ? [{ name: ClaimsOrganizationSchemaorg.alternateName, value: apodo }] : []),
          ...buildOfferOrderIndexedAttributes(processedClaims),
        ],
        hmac: { id: 'urn:unsupported', type: 'Sha256HmacKey2019' },
      },
      content: {
        status: EntityLifecycleStatus.Pending,
        claims: processedClaims,
        contained: [person, processedService].filter(Boolean) as IncludedResource[],
      } satisfies FamilyRegistrationContent,
    };
    const secureDoc = await this.kmsService.protectConfidentialData(registrationDoc, tenantVaultId);
    await this.vaultRepository.put(tenantCollectionName, [secureDoc], INDIVIDUAL_SECTION);

    return {
      type: 'Family-registration-offer-v1.0',
      resource: { resourceType: ResourceTypesFhirR4.Organization, id: familyDocId, meta: { claims: {
        ...processedClaims,
        [GatewayClaim.FamilyRegistrationStatus]: finalReadiness.isDraft
          ? FamilyRegistrationStatus.DraftSaved
          : FamilyRegistrationStatus.Created,
      } } },
      response: { status: '201' },
    };
  }

  /**
   * Completes only identity fields absent from an idempotent legacy record.
   *
   * Early portal/telephone registrations could persist the owner and nickname
   * without the public card alias or ONESELF relationship. A retry must recover
   * that authoritative Organization instead of creating a browser-local card or
   * silently returning an unusable record. Existing values are never replaced.
   */
  private async repairLegacyFamilyCardIdentity(
    tenantCollectionName: string,
    tenantVaultId: string,
    secureDocument: ConfidentialStorageDoc,
    content: FamilyRegistrationContent,
    requestedClaims: ClaimsRecord,
  ): Promise<FamilyRegistrationContent> {
    const existingClaims = content?.claims || {};
    const existingSameAs = String(existingClaims[ClaimsOrganizationSchemaorg.sameAs] || '').trim();
    const requestedSameAs = String(requestedClaims[ClaimsOrganizationSchemaorg.sameAs] || '').trim();
    const memberRoleClaim = 'org.schema.Organization.member.role';
    const existingRole = String(existingClaims[memberRoleClaim] || '').trim();
    const requestedRole = String(requestedClaims[memberRoleClaim] || '').trim();
    const recoveredClaims: ClaimsRecord = {
      ...existingClaims,
      ...(!existingSameAs && requestedSameAs
        ? { [ClaimsOrganizationSchemaorg.sameAs]: requestedSameAs }
        : {}),
      ...(!existingRole && requestedRole ? { [memberRoleClaim]: requestedRole } : {}),
    };
    const changed = recoveredClaims[ClaimsOrganizationSchemaorg.sameAs] !== existingClaims[ClaimsOrganizationSchemaorg.sameAs]
      || recoveredClaims[memberRoleClaim] !== existingClaims[memberRoleClaim];
    if (!changed) return content;

    const existingAttributes = secureDocument.indexed?.attributes || [];
    const indexedAliases = requestedSameAs
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
      .filter(value => !existingAttributes.some(attribute =>
        attribute.name === ClaimsOrganizationSchemaorg.sameAs && attribute.value === value));
    const recoveredContent: FamilyRegistrationContent = { ...content, claims: recoveredClaims };
    const recoveredDocument: ConfidentialStorageDoc & { meta?: Record<string, unknown> } = {
      ...secureDocument,
      sequence: Number(secureDocument.sequence || 0) + 1,
      meta: { claims: recoveredClaims },
      indexed: {
        ...(secureDocument.indexed || {}),
        attributes: [
          ...existingAttributes,
          ...indexedAliases.map(value => ({ name: ClaimsOrganizationSchemaorg.sameAs, value })),
        ],
      } as ConfidentialStorageDoc['indexed'],
      content: recoveredContent,
    };
    const protectedDocument = await this.kmsService.protectConfidentialData(recoveredDocument, tenantVaultId);
    await this.vaultRepository.put(tenantCollectionName, [protectedDocument], INDIVIDUAL_SECTION);
    return recoveredContent;
  }

  private async processIndividualOnboardingPdfDraftEntry(job: JobRequest, entry: BundleEntry): Promise<BundleEntry | ErrorEntry> {
    if (job.action !== '_create') {
      throw new ManagerError(`Unsupported family Action operation: '${job.action}'`, IssueType.NotSupported);
    }

    const entryResourceMeta = (entry?.resource?.meta && typeof entry.resource.meta === 'object')
      ? entry.resource.meta as Record<string, unknown>
      : {};
    const entryClaims = (entryResourceMeta.claims && typeof entryResourceMeta.claims === 'object')
      ? entryResourceMeta.claims as Record<string, unknown>
      : {};
    const template = entryResourceMeta.template as any;
    const formFields = entryResourceMeta.formFields as any;
    const kyc = entryResourceMeta.kyc as any;
    const subjectDid = String(
      entryClaims[ClaimsOrganizationSchemaorg.identifier]
      || entryClaims[ClaimsPersonSchemaorg.identifier]
      || entryClaims[ClaimsServiceSchemaorg.identifier]
      || '',
    ).trim();

    if (!subjectDid) {
      throw new ManagerError(
        `Individual onboarding PDF draft requires one subject identifier claim such as '${ClaimsOrganizationSchemaorg.identifier}'.`,
        IssueType.Required,
      );
    }

    const documentReferenceEntry = await buildIndividualOnboardingPdfDraftResponse(
      {
        template,
        formFields,
        kyc,
        claims: entryClaims,
      },
      subjectDid,
      String(entry?.resource?.id || '').trim() || undefined,
    );

    return {
      type: documentReferenceEntry.type,
      resource: documentReferenceEntry.resource as any,
      response: { status: String(HttpStatusCodes.Ok) },
    };
  }

  private async resolveIndividualRegistrationAttachmentClaims(job: JobRequest): Promise<ClaimsRecord | undefined> {
    const decodedContent = job.content as Record<string, any> | undefined;
    const attachmentResult = await buildClaimsFromIndividualRegistrationPdfAttachment(
      decodedContent?.attachments || decodedContent?.body?.attachments,
    );
    if (!attachmentResult) return undefined;
    return attachmentResult.claims as ClaimsRecord;
  }

  private resolveIndividualRegistrationEntryMeta(entry: BundleEntry): Record<string, unknown> | undefined {
    const entryMeta = entry?.meta;
    const resourceMeta = (entry?.resource as Record<string, unknown> | undefined)?.meta;
    const normalizedEntryMeta = (entryMeta && typeof entryMeta === 'object') ? entryMeta as Record<string, unknown> : undefined;
    const normalizedResourceMeta = (resourceMeta && typeof resourceMeta === 'object') ? resourceMeta as Record<string, unknown> : undefined;

    if (!normalizedEntryMeta && !normalizedResourceMeta) return undefined;
    return {
      ...(normalizedResourceMeta || {}),
      ...(normalizedEntryMeta || {}),
    };
  }

  private resolveIndividualRegistrationKycClaims(
    entry: BundleEntry,
    normalizedRawClaims?: ClaimsRecord,
    attachmentClaims?: ClaimsRecord,
  ): ClaimsRecord | undefined {
    const meta = this.resolveIndividualRegistrationEntryMeta(entry);
    if (!meta) return undefined;

    const extensions = (meta.extensions && typeof meta.extensions === 'object')
      ? meta.extensions as Record<string, unknown>
      : undefined;
    const rawKyc = meta.kyc ?? extensions?.kyc;
    if (!rawKyc || typeof rawKyc !== 'object') return undefined;

    const kycPayload = rawKyc as Record<string, unknown>;
    const profile = (kycPayload.profile && typeof kycPayload.profile === 'object')
      ? kycPayload.profile as Record<string, unknown>
      : kycPayload;
    if (!profile || Object.keys(profile).length === 0) return undefined;
    const kycVerifiedAt = String(profile.kyc_verified_at || '').trim();
    if (!kycVerifiedAt || Number.isNaN(Date.parse(kycVerifiedAt))) {
      throw new ManagerError(
        'KYC fallback requires a valid profile.kyc_verified_at timestamp.',
        IssueType.Invalid,
      );
    }

    const fallbackClaims = attachmentClaims || normalizedRawClaims;
    const individualAlternateName =
      (typeof kycPayload.individualAlternateName === 'string' ? kycPayload.individualAlternateName : undefined) ||
      (fallbackClaims?.[ClaimsOrganizationSchemaorg.alternateName] as string | undefined);
    const individualBirthDate =
      (typeof kycPayload.individualBirthDate === 'string' ? kycPayload.individualBirthDate : undefined) ||
      (fallbackClaims?.[ClaimsPersonSchemaorg.birthDate] as string | undefined);
    const controllerEmail =
      (typeof kycPayload.controllerEmail === 'string' ? kycPayload.controllerEmail : undefined) ||
      (fallbackClaims?.[ClaimsOrganizationSchemaorg.ownerEmail] as string | undefined) ||
      (fallbackClaims?.[ClaimsPersonSchemaorg.email] as string | undefined);

    return buildClaimsFromIndividualOrganizationKyc({
      profile,
      individualAlternateName: String(individualAlternateName || ''),
      individualBirthDate,
      controllerEmail,
    }).claims as ClaimsRecord;
  }

  private async processFamilyOrderEntry(job: JobRequest, entry: BundleEntry, environment?: string): Promise<(BundleEntry | ErrorEntry)[]> {
    const entryType = entry.type || 'Family-order-request-v1.0';
    const rawClaims = entry?.resource?.meta?.claims;
    const claims: ClaimsRecord | undefined = rawClaims ? (normalizeContextualizedClaims(rawClaims) as ClaimsRecord) : rawClaims;
    if (!claims) {
      throw new ManagerError('Malformed order entry: missing meta.claims', IssueType.Required);
    }

    const offerId = getClaimValue<string>(claims, ClaimsOrderSchemaorg.acceptedOfferIdentifier);
    if (!offerId) {
      throw new ManagerError(
        formatMissingRequiredClaimDiagnostic(ClaimsOrderSchemaorg.acceptedOfferIdentifier, {
          context: 'in Order',
          displayLabel: toExternalClaimLabel(ClaimsOrderSchemaorg.acceptedOfferIdentifier),
        }),
        IssueType.Required,
      );
    }

    const tenantId = job.tenantId;
    const sector = job.sector as Sector | undefined;
    if (!tenantId || !sector) {
      throw new ManagerError('Job is missing tenantId or sector.', IssueType.Required);
    }

    const tenantVaultId = getTenantVaultId(sector, tenantId);
    const tenantCollectionName = await this.tenantsCacheManager.getCollectionName(tenantVaultId);
    if (!tenantCollectionName) {
      throw new ManagerError(`Tenant not found in cache: '${tenantVaultId}'`, IssueType.NotFound);
    }

    const results = await this.vaultRepository.query(tenantCollectionName, {
      sectionId: INDIVIDUAL_SECTION,
      where: [{ name: ClaimsOfferSchemaorg.identifier, value: offerId }],
    });

    if (results.length === 0) {
      return [await this.processFamilyLicenseOrderEntry(job, claims, offerId)];
    }
    if (results.length > 1) {
      this.logger.error(`CRITICAL: Multiple pending family registrations found for the same offerId: '${offerId}'`);
      throw new ManagerError('Internal system conflict. Multiple pending registrations found.', IssueType.Conflict);
    }

    const secureDoc = results[0] as ConfidentialStorageDoc;
    const decryptedContent = await this.kmsService.unprotectConfidentialData<FamilyRegistrationContent>(secureDoc, tenantVaultId);
    if (decryptedContent?.status !== EntityLifecycleStatus.Pending) {
      if (decryptedContent?.status === EntityLifecycleStatus.Active) {
        return this.repairActiveFamilyOrderController({
          job,
          offerId,
          tenantVaultId,
          tenantCollectionName,
          secureDocument: secureDoc,
          content: decryptedContent,
        });
      }
      throw new ManagerError(`Found family registration for offerId '${offerId}', but it is not in 'pending' state.`, IssueType.Conflict);
    }
    ensureNamedHumanSubjectCardAlias(decryptedContent.claims, secureDoc.id);
    const registrationReadiness = readIndividualRegistrationReadiness(decryptedContent.claims);
    if (!registrationReadiness.ready) {
      throw new ManagerError(
        `${registrationReadiness.profile === 'veterinary' ? 'Animal' : 'Human'} draft cannot become active until these fields are completed: ${registrationReadiness.missing.join(', ')}.`,
        IssueType.Required,
      );
    }

    const finalizedContent: FamilyRegistrationContent = {
      ...decryptedContent,
      status: EntityLifecycleStatus.Active,
    };

    // Create individual (family member) license seats purchased via the family registration Offer and auto-issue one for the controller.
    let controllerAssignmentEntry: BundleEntry | undefined;
    const familySeats = finalizedContent.claims[ClaimsOfferSchemaorg.eligibleQuantityValue] as number | undefined;
    const familyOfferIdentifier = finalizedContent.claims[ClaimsOfferSchemaorg.identifier] as string | undefined;
    if (familySeats && familySeats > 0 && familyOfferIdentifier) {
      await materializeFreeIndividualLicenses({
        vaultRepository: this.vaultRepository,
        tenantVaultId,
        tenantId,
        ownerOrganizationId: secureDoc.id,
        quantity: familySeats,
        ensureTotal: true,
        orderId: familyOfferIdentifier,
        type: LICENSE_TYPE_MOBILE,
      });

      const controllerEmail =
        finalizedContent.claims[ClaimsOrganizationSchemaorg.ownerEmail] as string | undefined
        || finalizedContent.claims[ClaimsPersonSchemaorg.email] as string | undefined;
      const controllerPhoneForActivation =
        finalizedContent.claims[ClaimsOrganizationSchemaorg.ownerTelephone] as string | undefined
        || finalizedContent.claims[ClaimsPersonSchemaorg.telephone] as string | undefined;
      const controllerContact = controllerEmail || controllerPhoneForActivation;
      const controllerRole = `${HL7_CODING_SYSTEM_V3_ROLE_CODE}|${HealthcareActorRoleCodes.Controller}`;
      if (controllerContact) {
        try {
          const privateSubjectUuid = normalizeUuid(secureDoc.id);
          const authorizedSubjectDid = privateSubjectUuid
            ? buildCanonicalIndividualSubjectDid(
              String(finalizedContent.claims[ClaimsOfferSchemaorg.offeredBy] || '').trim(),
              secureDoc.id,
            )
            : String(finalizedContent.claims[ClaimsOrganizationSchemaorg.sameAs] || '')
              .split(',')
              .map((value) => value.trim())
              .find((value) => value.startsWith('did:web:'));
          if (!authorizedSubjectDid) {
            throw new ManagerError(
              'The family Order requires a canonical UUID subject or an existing did:web subject alias.',
              IssueType.Required,
            );
          }
          const controllerAssignmentIdentifier = canonicalControllerUuidOrNew(
            finalizedContent.claims[ClaimsOrganizationSchemaorg.ownerIdentifierValue],
          );
          finalizedContent.claims[ClaimsOrganizationSchemaorg.ownerIdentifierValue] = controllerAssignmentIdentifier;
          const { activationCode } = await issueActivationCodeFromPool({
            vaultRepository: this.vaultRepository,
            kmsService: this.kmsService,
            tenantVaultId,
            userClass: LICENSE_USER_CLASS_INDIVIDUAL,
            type: LICENSE_TYPE_MOBILE,
            ...(controllerEmail
              ? { email: controllerEmail }
              : { phone: controllerPhoneForActivation }),
            role: controllerRole,
            orderId: familyOfferIdentifier,
            ownerOrganizationId: secureDoc.id,
            relatedPersonId: controllerAssignmentIdentifier,
            subjectId: secureDoc.id,
            subjectDid: authorizedSubjectDid,
            beforePersist: async (license) => {
              (license as DeviceLicense & Record<string, unknown>).authorizedSubjectAliases = [
                String(finalizedContent.claims[ClaimsOrganizationSchemaorg.sameAs] || '').trim(),
              ].filter(Boolean);
            },
          });
          controllerAssignmentEntry = await this.materializePrimaryControllerAssignment({
            tenantVaultId,
            subjectDid: authorizedSubjectDid,
            assignmentIdentifier: controllerAssignmentIdentifier,
            controllerRole,
            controllerEmail,
            controllerTelephone: controllerEmail ? undefined : controllerPhoneForActivation,
          });
          finalizedContent.claims[ClaimsIndividualProductSchemaorg.serialNumber] = activationCode;
          finalizedContent.claims[ClaimsIndividualProductSchemaorg.category] = LICENSE_CATEGORY_INDIVIDUAL;
        } catch (e: any) {
          throw new ManagerError(
            `The family Order could not issue its controller activation code: ${String(e?.message || e)}`,
            IssueType.Exception,
          );
        }
      }
    }

    if (!String(finalizedContent.claims[ClaimsIndividualProductSchemaorg.serialNumber] || '').trim()) {
      throw new ManagerError(
        'The family Order cannot become active without its controller activation code.',
        IssueType.Conflict,
      );
    }

    const updatedDoc: ConfidentialStorageDoc & { meta?: Record<string, unknown> } = {
      id: secureDoc.id,
      status: finalizedContent.status,
      sequence: (secureDoc.sequence || 0) + 1,
      // Offer/Order searches intentionally use non-hydrated projections. Keep
      // the auditable public claims when transitioning pending -> active;
      // dropping this field made a successfully confirmed Offer disappear
      // from `_search` while its encrypted content still existed.
      meta: (secureDoc as ConfidentialStorageDoc & { meta?: Record<string, unknown> }).meta
        || { claims: finalizedContent.claims },
      indexed: secureDoc.indexed,
      content: finalizedContent,
    };
    const secureUpdatedDoc = await this.kmsService.protectConfidentialData(updatedDoc, tenantVaultId);
    await this.vaultRepository.put(tenantCollectionName, [secureUpdatedDoc], INDIVIDUAL_SECTION);

    const tenantDid = await this.tenantsCacheManager.getTenantDid(tenantVaultId);
    if (!tenantDid) {
      throw new ManagerError(`Tenant DID not found for '${tenantVaultId}'`, IssueType.NotFound);
    }
    const recipientDid = job.content?.iss || tenantDid;
    const paymentContext = {
      offerId,
      tenantId,
      tenantDid: recipientDid,
      senderDid: tenantDid,
      email:
        finalizedContent.claims[ClaimsOrganizationSchemaorg.ownerEmail] as string | undefined
        || finalizedContent.claims[ClaimsPersonSchemaorg.email] as string | undefined,
      legalName: finalizedContent.claims[ClaimsOrganizationSchemaorg.legalName] as string | undefined,
      addressCountry: finalizedContent.claims[ClaimsOrganizationSchemaorg.addressCountry] as string | undefined,
      addressRegion: finalizedContent.claims[ClaimsOrganizationSchemaorg.addressRegion] as string | undefined,
      addressLocality: finalizedContent.claims[ClaimsOrganizationSchemaorg.addressLocality] as string | undefined,
      postalCode: finalizedContent.claims[ClaimsOrganizationSchemaorg.postalCode] as string | undefined,
      streetAddress: finalizedContent.claims[ClaimsOrganizationSchemaorg.streetAddress] as string | undefined,
      activationCode: (finalizedContent.claims as any)['org.schema.IndividualProduct.serialNumber'] as string | undefined,
      activationCategory: (finalizedContent.claims as any)['org.schema.IndividualProduct.category'] as string | undefined,
      paymentMethod: claims[ClaimsOrderSchemaorg.paymentMethod] as string | undefined,
      paymentUrl: claims[ClaimsOrderSchemaorg.paymentUrl] as string | undefined,
      invoiceId: claims[ClaimsOrderSchemaorg.partOfInvoice] as string | undefined,
      paymentConfirmed: true,
      ...readOfferPaymentContext(finalizedContent.claims),
    };
    const paymentCommunication = await buildPaymentCommunication(paymentContext);
    const invoiceBundle = buildGatewayInvoiceBundle({
      invoiceId: String(
        paymentCommunication.claims[ClaimsOrderSchemaorg.partOfInvoice]
        || paymentCommunication.claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier]
        || offerId,
      ),
      subjectReference: recipientDid,
      issuerReference: tenantDid,
      recipientReference: recipientDid,
      issuedAt: String(
        paymentCommunication.claims['org.schema.Order.invoiceIssuedAt']
        || new Date().toISOString(),
      ),
      amount: String(finalizedContent.claims[ClaimsOfferSchemaorg.price] || ''),
      currency: String(finalizedContent.claims[ClaimsOfferSchemaorg.priceCurrency] || ''),
      paymentMethod: claims[ClaimsOrderSchemaorg.paymentMethod] as string | undefined,
      paymentUrl: claims[ClaimsOrderSchemaorg.paymentUrl] as string | undefined,
    });

    const communicationDoc: ConfidentialStorageDoc & { meta?: Record<string, unknown> } = {
      id: paymentCommunication.communicationId,
      status: EntityLifecycleStatus.Active,
      sequence: 0,
      meta: { claims: paymentCommunication.claims },
      indexed: {
        attributes: buildOfferOrderIndexedAttributes(paymentCommunication.claims),
        hmac: { id: 'urn:unsupported', type: 'Sha256HmacKey2019' },
      },
      content: { claims: paymentCommunication.claims, invoiceBundle },
    };
    const secureCommunicationDoc = await this.kmsService.protectConfidentialData(communicationDoc, tenantVaultId);
    await this.vaultRepository.put(tenantCollectionName, [secureCommunicationDoc], getEnvSectionId('communications'));

    const orderEntry: BundleEntry = {
      type: 'Family-order-response-v1.0',
      resource: { ...(invoiceBundle as any), meta: { ...((invoiceBundle as any).meta || {}), claims: paymentCommunication.claims } },
      response: { status: '201' },
    };
    return controllerAssignmentEntry ? [orderEntry, controllerAssignmentEntry] : [orderEntry];
  }

  /** Backfills the missing controller assignment of one authenticated legacy Order replay. */
  private async repairActiveFamilyOrderController(input: Readonly<{
    job: JobRequest;
    offerId: string;
    tenantVaultId: string;
    tenantCollectionName: string;
    secureDocument: ConfidentialStorageDoc;
    content: FamilyRegistrationContent;
  }>): Promise<(BundleEntry | ErrorEntry)[]> {
    const controllerEmail = String(
      input.content.claims[ClaimsOrganizationSchemaorg.ownerEmail]
      || input.content.claims[ClaimsPersonSchemaorg.email]
      || '',
    ).trim();
    const controllerTelephone = String(
      input.content.claims[ClaimsOrganizationSchemaorg.ownerTelephone]
      || input.content.claims[ClaimsPersonSchemaorg.telephone]
      || '',
    ).trim();
    const authorizedIdentifiers = [
      controllerEmail ? buildStableActorIdentifier({
        contactKind: StableActorContactKinds.Email,
        contact: controllerEmail,
      }) : '',
      controllerTelephone ? buildStableActorIdentifier({
        contactKind: StableActorContactKinds.Phone,
        contact: controllerTelephone,
      }) : '',
    ].filter(Boolean);
    const authenticatedIdentifiers = new Set(getAuthenticatedJobActorIdentifiers(input.job));
    if (!authorizedIdentifiers.some((identifier) => authenticatedIdentifiers.has(identifier))) {
      throw new ManagerError(
        'Only the verified individual controller may replay an active family Order.',
        IssueType.Security,
      );
    }

    const persistedActivationCode = String(
      input.content.claims[ClaimsIndividualProductSchemaorg.serialNumber] || '',
    ).trim();
    const licenseDocuments = await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(
      input.tenantVaultId,
      DEVICE_LICENSE_SECTION,
    );
    const controllerLicenseMatches: Array<{
      document: ConfidentialStorageDoc;
      license: DeviceLicense & Record<string, any>;
    }> = [];
    const existingControllerSeats: Array<{
      document: ConfidentialStorageDoc;
      license: DeviceLicense & Record<string, any>;
    }> = [];
    for (const document of licenseDocuments) {
      const license = document.content
        ? document.content as DeviceLicense & Record<string, any>
        : await this.kmsService.unprotectConfidentialData<DeviceLicense & Record<string, any>>(
            document,
            input.tenantVaultId,
          );
      const activationCode = String(license?.activationCode || '').trim();
      const ownsIndividual = String(license?.ownerOrganizationId || license?.subjectId || '').trim()
        === input.secureDocument.id;
      if (!activationCode || !ownsIndividual) continue;
      if (persistedActivationCode) {
        if (activationCode === persistedActivationCode) {
          controllerLicenseMatches.push({ document, license });
          break;
        }
        continue;
      }
      const issuedEmail = normalizeIndexedEmail(String(license.issuedToEmail || ''));
      const issuedTelephone = normalizeIndexedPhone(String(license.issuedToPhone || ''));
      const role = String(license.issuedToRole || '').trim().split('|').at(-1)?.toUpperCase();
      const isControllerSeat = String(license.status || document.status || '').trim() === LICENSE_STATUS_ISSUED
        && String(license.orderId || '').trim() === input.offerId
        && role === HealthcareActorRoleCodes.Controller;
      if (isControllerSeat) existingControllerSeats.push({ document, license });
      if (isControllerSeat
        && ((controllerEmail && issuedEmail === normalizeIndexedEmail(controllerEmail))
          || (controllerTelephone && issuedTelephone === normalizeIndexedPhone(controllerTelephone)))) {
        controllerLicenseMatches.push({ document, license });
      }
    }
    if (!persistedActivationCode && controllerLicenseMatches.length > 1) {
      throw new ManagerError(
        'The active family Order has several matching controller activation seats.',
        IssueType.Conflict,
      );
    }
    if (!persistedActivationCode
      && controllerLicenseMatches.length === 0
      && existingControllerSeats.length > 0) {
      throw new ManagerError(
        'The active family Order controller seat does not match its verified owner contact.',
        IssueType.Conflict,
      );
    }
    const assignmentIdentifier = canonicalControllerUuidOrNew(
      normalizeUuid(input.content.claims[ClaimsOrganizationSchemaorg.ownerIdentifierValue])
      || normalizeUuid(controllerLicenseMatches[0]?.license.relatedPersonId),
    );
    // Historical multibase subjects are authoritative when already bound to
    // the issued seat. Only a missing value is reconstructed from the UUID.
    const subjectDid = String(controllerLicenseMatches[0]?.license.authorizedSubjectDid || '').trim()
      || buildCanonicalIndividualSubjectDid(
        String(input.content.claims[ClaimsOfferSchemaorg.offeredBy] || '').trim(),
        input.secureDocument.id,
      );
    const controllerRole = String(controllerLicenseMatches[0]?.license.issuedToRole || '').trim()
      || `${HL7_CODING_SYSTEM_V3_ROLE_CODE}|${HealthcareActorRoleCodes.Controller}`;
    let controllerLicenseDocument: ConfidentialStorageDoc | undefined = controllerLicenseMatches[0]?.document;
    let controllerLicense: (DeviceLicense & Record<string, any>) | undefined = controllerLicenseMatches[0]?.license;
    if (!controllerLicenseDocument || !controllerLicense) {
      const quantity = Number(input.content.claims[ClaimsOfferSchemaorg.eligibleQuantityValue] || 1);
      await materializeFreeIndividualLicenses({
        vaultRepository: this.vaultRepository,
        tenantVaultId: input.tenantVaultId,
        tenantId: input.job.tenantId!,
        ownerOrganizationId: input.secureDocument.id,
        quantity: Math.max(1, quantity),
        ensureTotal: true,
        orderId: input.offerId,
        type: LICENSE_TYPE_MOBILE,
      });
      const issued = await issueActivationCodeFromPool({
        vaultRepository: this.vaultRepository,
        kmsService: this.kmsService,
        tenantVaultId: input.tenantVaultId,
        userClass: LICENSE_USER_CLASS_INDIVIDUAL,
        type: LICENSE_TYPE_MOBILE,
        ...(controllerEmail ? { email: controllerEmail } : { phone: controllerTelephone }),
        role: controllerRole,
        orderId: input.offerId,
        ownerOrganizationId: input.secureDocument.id,
        relatedPersonId: assignmentIdentifier,
        subjectId: input.secureDocument.id,
        subjectDid,
        beforePersist: async (license) => {
          (license as DeviceLicense & Record<string, unknown>).authorizedSubjectAliases = [
            String(input.content.claims[ClaimsOrganizationSchemaorg.sameAs] || '').trim(),
          ].filter(Boolean);
        },
      });
      controllerLicenseDocument = await this.vaultRepository.get<ConfidentialStorageDoc>(
        input.tenantVaultId,
        issued.licenseId,
        DEVICE_LICENSE_SECTION,
      );
      if (controllerLicenseDocument) {
        controllerLicense = controllerLicenseDocument.content
          ? controllerLicenseDocument.content as DeviceLicense & Record<string, any>
          : await this.kmsService.unprotectConfidentialData<DeviceLicense & Record<string, any>>(
            controllerLicenseDocument,
            input.tenantVaultId,
          );
      }
    }
    if (!controllerLicenseDocument || !controllerLicense) {
      throw new ManagerError(
        'The active family Order could not restore its licensed individual controller seat.',
        IssueType.Exception,
      );
    }
    const activationCode = String(controllerLicense.activationCode || '').trim();
    if (input.content.claims[ClaimsOrganizationSchemaorg.ownerIdentifierValue] !== assignmentIdentifier
      || input.content.claims[ClaimsIndividualProductSchemaorg.serialNumber] !== activationCode
      || input.content.claims[ClaimsIndividualProductSchemaorg.category] !== LICENSE_CATEGORY_INDIVIDUAL) {
      const repairedClaims = {
        ...input.content.claims,
        [ClaimsOrganizationSchemaorg.ownerIdentifierValue]: assignmentIdentifier,
        [ClaimsIndividualProductSchemaorg.serialNumber]: activationCode,
        [ClaimsIndividualProductSchemaorg.category]: LICENSE_CATEGORY_INDIVIDUAL,
      };
      const repairedDocument: ConfidentialStorageDoc & { meta?: Record<string, unknown> } = {
        ...input.secureDocument,
        sequence: Number(input.secureDocument.sequence || 0) + 1,
        meta: { claims: repairedClaims },
        content: { ...input.content, claims: repairedClaims },
      };
      const protectedDocument = await this.kmsService.protectConfidentialData(
        repairedDocument,
        input.tenantVaultId,
      );
      await this.vaultRepository.put(
        input.tenantCollectionName,
        [protectedDocument],
        INDIVIDUAL_SECTION,
      );
      input.content.claims = repairedClaims;
    }

    if (controllerLicense.relatedPersonId !== assignmentIdentifier
      || controllerLicense.subjectId !== input.secureDocument.id
      || controllerLicense.authorizedSubjectDid !== subjectDid) {
      const protectedLicense = await this.kmsService.protectConfidentialData({
        ...controllerLicenseDocument,
        sequence: Number(controllerLicenseDocument.sequence || 0) + 1,
        content: {
          ...controllerLicense,
          relatedPersonId: assignmentIdentifier,
          subjectId: input.secureDocument.id,
          authorizedSubjectDid: subjectDid,
        },
      }, input.tenantVaultId);
      await this.vaultRepository.put(
        input.tenantVaultId,
        [protectedLicense],
        DEVICE_LICENSE_SECTION,
      );
    }

    const assignmentSectionId = getSubjectScopedSectionId(
      subjectDid,
      SUBJECT_SECTION_INDIVIDUAL,
      'related-persons',
    );
    const assignmentExists = Boolean(await this.vaultRepository.get(
      input.tenantVaultId,
      assignmentIdentifier,
      assignmentSectionId,
    ));
    const assignmentEntry = await this.materializePrimaryControllerAssignment({
      tenantVaultId: input.tenantVaultId,
      subjectDid,
      assignmentIdentifier,
      controllerRole,
      controllerEmail,
      controllerTelephone: controllerEmail ? undefined : controllerTelephone,
      persist: !assignmentExists,
    });
    return [{
      type: 'Family-order-response-v1.0',
      resource: {
        resourceType: ResourceTypesFhirR4.Organization,
        id: input.secureDocument.id,
        meta: { claims: {
          ...input.content.claims,
          [ClaimsOrderSchemaorg.acceptedOfferIdentifier]: input.offerId,
          [ClaimsIndividualProductSchemaorg.serialNumber]: activationCode,
          [ClaimsIndividualProductSchemaorg.category]: LICENSE_CATEGORY_INDIVIDUAL,
        } },
      },
      response: { status: '200' },
    }, assignmentEntry];
  }

  /**
   * Materializes the principal owner/controller as one claims-first FHIR-like
   * RelatedPerson assignment. The authoritative source remains the validated
   * individual Organization owner plus its issued RESPRSN seat; portals never
   * create or select this assignment separately.
   */
  private async materializePrimaryControllerAssignment(input: Readonly<{
    tenantVaultId: string;
    subjectDid: string;
    assignmentIdentifier: string;
    controllerRole: string;
    controllerEmail?: string;
    controllerTelephone?: string;
    persist?: boolean;
  }>): Promise<BundleEntry> {
    const telecom = input.controllerEmail
      ? `mailto:${normalizeIndexedEmail(input.controllerEmail)}`
      : normalizeIndexedPhone(input.controllerTelephone);
    const claims = normalizeContextualizedClaims({
      '@context': Format.FHIR_API,
      [RelatedPersonClaim.Identifier]: input.assignmentIdentifier,
      [RelatedPersonClaim.Patient]: input.subjectDid,
      [RelatedPersonClaim.Relationship]: input.controllerRole,
      [RelatedPersonClaim.Active]: 'true',
      ...(telecom ? { [RelatedPersonClaim.Telecom]: telecom } : {}),
    });
    const resource: BundleEntry['resource'] = {
      resourceType: ResourceTypesFhirR4.RelatedPerson,
      id: input.assignmentIdentifier,
      meta: { claims },
    } as BundleEntry['resource'];
    validateFhirPayloadByVersion(Format.FHIR_API, ResourceTypesFhirR4.RelatedPerson, { resource });
    if (input.persist !== false) {
      await this.vaultRepository.put(input.tenantVaultId, [{
        id: input.assignmentIdentifier,
        status: EntityLifecycleStatus.Active,
        ...claims,
      } as ConfidentialStorageDoc], getSubjectScopedSectionId(
        input.subjectDid,
        SUBJECT_SECTION_INDIVIDUAL,
        'related-persons',
      ));
    }
    return {
      type: ResourceTypesFhirR4.RelatedPerson,
      resource,
      response: { status: String(input.persist === false ? HttpStatusCodes.Ok : HttpStatusCodes.Created) },
    };
  }

  private async processFamilyLicenseOrderEntry(
    job: JobRequest,
    orderClaims: ClaimsRecord,
    offerId: string,
  ): Promise<BundleEntry | ErrorEntry> {
    const tenantId = job.tenantId;
    const sector = job.sector as Sector | undefined;
    if (!tenantId || !sector) {
      throw new ManagerError('Job is missing tenantId or sector.', IssueType.Required);
    }
    const tenantVaultId = getTenantVaultId(sector, tenantId);
    const tenantCollectionName = await this.tenantsCacheManager.getCollectionName(tenantVaultId);
    if (!tenantCollectionName) {
      throw new ManagerError(`Tenant not found in cache: '${tenantVaultId}'`, IssueType.NotFound);
    }

    const records = await this.vaultRepository.query(
      tenantCollectionName,
      {
        sectionId: getEnvSectionId('communications'),
        where: [{ name: ClaimsOfferSchemaorg.identifier, value: offerId }],
      },
      { hydrate: false },
    );
    let matchedOfferClaims: Record<string, unknown> | undefined;
    for (const secureDoc of records as ConfidentialStorageDoc[]) {
      const candidateClaims = readProjectedOfferOrderClaims(secureDoc);
      if (String(candidateClaims[ClaimsOfferSchemaorg.identifier] || '').trim() === offerId) {
        matchedOfferClaims = candidateClaims;
        break;
      }
    }
    if (!matchedOfferClaims) {
      throw new ManagerError(`No pending family registration or commercial offer found for offerId: '${offerId}'`, IssueType.NotFound);
    }

    const verification = await verifyOrderPaymentConfirmation({
      orderClaims,
      offerClaims: matchedOfferClaims,
    });
    if (!verification.verified) {
      throw new ManagerError(`Payment confirmation failed for offerId '${offerId}'.`, IssueType.Conflict);
    }

    const quantity = Number(matchedOfferClaims[ClaimsOfferSchemaorg.eligibleQuantityValue] || 1);
    const now = Date.now();
    const expiryDate = new Date(now);
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    const exp = Math.floor(expiryDate.getTime() / 1000);
    const licenseDocs: ConfidentialStorageDoc[] = [];
    for (let i = 0; i < quantity; i++) {
      const licenseId = uuidv4();
      const license: DeviceLicense = {
        id: licenseId,
        tenantId,
        orderId: verification.invoiceId || offerId,
        userClass: LICENSE_USER_CLASS_INDIVIDUAL,
        type: LICENSE_TYPE_MOBILE,
        status: LICENSE_STATUS_AVAILABLE,
        plan: 'default',
        renewalCycle: '12m',
        reactivationEnabled: false,
        exp,
      } as any;
      licenseDocs.push({ id: licenseId, status: license.status, sequence: 0, content: license });
    }
    await this.vaultRepository.put(tenantVaultId, licenseDocs, DEVICE_LICENSE_SECTION);

    const tenantDid = await this.tenantsCacheManager.getTenantDid(tenantVaultId);
    if (!tenantDid) {
      throw new ManagerError(`Tenant DID not found for '${tenantVaultId}'`, IssueType.NotFound);
    }
    const paymentCommunication = await buildPaymentCommunication({
      offerId,
      tenantId,
      tenantDid,
      senderDid: tenantDid,
      paymentMethod: verification.paymentMethod,
      paymentUrl: verification.paymentUrl,
      invoiceId: verification.invoiceId,
      paymentConfirmed: true,
      ...readOfferPaymentContext(matchedOfferClaims),
    });
    const invoiceBundle = buildGatewayInvoiceBundle({
      invoiceId: String(
        paymentCommunication.claims[ClaimsOrderSchemaorg.partOfInvoice]
        || verification.invoiceId
        || offerId,
      ),
      subjectReference: tenantDid,
      issuerReference: tenantDid,
      recipientReference: tenantDid,
      issuedAt: String(
        paymentCommunication.claims['org.schema.Order.invoiceIssuedAt']
        || new Date().toISOString(),
      ),
      amount: String(matchedOfferClaims[ClaimsOfferSchemaorg.price] || ''),
      currency: String(matchedOfferClaims[ClaimsOfferSchemaorg.priceCurrency] || ''),
      paymentMethod: verification.paymentMethod,
      paymentUrl: verification.paymentUrl,
    });

    const communicationDoc: ConfidentialStorageDoc & { meta?: Record<string, unknown> } = {
      id: paymentCommunication.communicationId,
      status: EntityLifecycleStatus.Active,
      sequence: 0,
      meta: { claims: paymentCommunication.claims },
      indexed: {
        attributes: buildOfferOrderIndexedAttributes(paymentCommunication.claims),
        hmac: { id: 'urn:unsupported', type: 'Sha256HmacKey2019' },
      },
      content: { claims: paymentCommunication.claims, invoiceBundle },
    };
    const secureCommunicationDoc = await this.kmsService.protectConfidentialData(communicationDoc, tenantVaultId);
    await this.vaultRepository.put(tenantCollectionName, [secureCommunicationDoc], getEnvSectionId('communications'));

    return {
      type: 'Family-order-response-v1.0',
      resource: { ...(invoiceBundle as any), meta: { ...((invoiceBundle as any).meta || {}), claims: paymentCommunication.claims } },
      response: { status: '201' },
    };
  }

  private handleError(error: any, entryType: string = 'unknown', meta?: any): ErrorEntry {
    if (error instanceof ManagerError) {
      return {
        type: entryType,
        meta,
        response: {
          status: error.status,
          outcome: createOperationOutcome(IssueLevel.Error, error.code, error.message),
        },
      };
    }
    this.logger.error('Unexpected error during family processing:', error);
    return {
      type: entryType,
      meta,
      response: {
        status: '500',
        outcome: createOperationOutcome(IssueLevel.Error, IssueType.Exception, 'An unexpected internal server error occurred.'),
      },
    };
  }

  /**
   * Resolves one exact card by sameAs, one idempotency record by owner+nickname,
   * or the complete owner directory when only indexed contact claims are sent.
   * The directory is the browser-independent card recovery contract.
   */
  private async processFamilySearchEntry(job: JobRequest, entry: BundleEntry, environment?: string): Promise<BundleEntry | ErrorEntry> {
    const rawClaims = entry?.resource?.meta?.claims;
    const claims: ClaimsRecord | undefined = rawClaims ? (normalizeContextualizedClaims(rawClaims) as ClaimsRecord) : rawClaims;
    if (!claims) {
      throw new ManagerError('Malformed entry: missing meta.claims', IssueType.Required);
    }

    const requestedSector = (job.sector || claims[ClaimsServiceSchemaorg.category]) as Sector | undefined;
    if (!requestedSector || !job.tenantId) {
      throw new ManagerError('Job is missing tenantId or sector.', IssueType.Required);
    }
    const tenantVaultId = getTenantVaultId(requestedSector, job.tenantId);
    const tenantCollectionName = await this.tenantsCacheManager.getCollectionName(tenantVaultId);
    if (!tenantCollectionName) {
      throw new ManagerError(`Tenant not found in cache: '${tenantVaultId}'`, IssueType.NotFound);
    }

    const sameAs = String(claims[ClaimsOrganizationSchemaorg.sameAs] || '').trim();
    const ownerPhones = splitIndexedPhones(claims['org.schema.Organization.owner.telephone'] as string | undefined);
    const ownerEmails = splitIndexedEmails(claims['org.schema.Organization.owner.email'] as string | undefined);
    this.assertOwnerDirectoryAuthorization(job, tenantVaultId, ownerPhones, ownerEmails);
    if (sameAs) {
      await this.assertRegisteredProfileSubjectAuthorization(job, tenantVaultId, sameAs);
    }
    const nickname = claims[ClaimsOrganizationSchemaorg.alternateName] as string | undefined;
    if (!sameAs && !nickname && (ownerPhones.length > 0 || ownerEmails.length > 0)) {
      return this.buildOwnedFamilyDirectoryResult(
        tenantVaultId,
        tenantCollectionName,
        ownerPhones,
        ownerEmails,
      );
    }
    if (!sameAs && ((ownerPhones.length === 0 && ownerEmails.length === 0) || !nickname)) {
      throw new ManagerError(
        `Missing required claims for search: exact '${ClaimsOrganizationSchemaorg.sameAs}', an owner email/telephone directory query, or '${ClaimsOrganizationSchemaorg.alternateName}' plus owner contact`,
        IssueType.Required,
      );
    }

    const foundResult = sameAs
      ? (await this.vaultRepository.query(tenantCollectionName, {
          sectionId: INDIVIDUAL_SECTION,
          where: [{ name: ClaimsOrganizationSchemaorg.sameAs, value: sameAs }],
        }))[0] as ConfidentialStorageDoc | undefined
      : await this.findFamilyRegistrationDoc(tenantCollectionName, ownerPhones, ownerEmails, nickname!);

    if (!foundResult) {
      return {
        type: 'Family-search-result-v1.0',
        resource: { resourceType: ResourceTypesFhirR4.Organization, meta: {
          claims: {
            [GatewayClaim.FamilyRegistrationStatus]: FamilyRegistrationStatus.NotFound,
            ...(sameAs
              ? { [ClaimsOrganizationSchemaorg.sameAs]: sameAs }
              : { [ClaimsOrganizationSchemaorg.alternateName]: nickname }),
          },
        } },
        response: { status: '200' },
      };
    }

    const decryptedContent = await this.kmsService.unprotectConfidentialData<FamilyRegistrationContent>(foundResult, tenantVaultId);
    const regStatus = decryptedContent?.status === EntityLifecycleStatus.Active ? 'already_exists' : 'resume_required';

    return {
      type: 'Family-search-result-v1.0',
      resource: { resourceType: ResourceTypesFhirR4.Organization, id: foundResult.id, meta: {
        claims: {
          ...decryptedContent?.claims,
          [GatewayClaim.FamilyRegistrationStatus]: regStatus,
        },
      } },
      response: { status: '200' },
    };
  }

  /**
   * Authorizes the second phase of the pre-SMART directory: after a licence
   * search found a related animal, the SDK may resolve that exact subject's
   * Organization. A protected-profile request may not use `sameAs` as an
   * unrestricted tenant directory lookup.
   */
  private async assertRegisteredProfileSubjectAuthorization(
    job: JobRequest,
    tenantVaultId: string,
    subjectDid: string,
  ): Promise<void> {
    const binding = (job.content as any)?.meta?.[REGISTERED_PROFILE_ACCOUNT_DIRECTORY_META];
    if (!binding) return;

    const expectedEmail = normalizeIndexedEmail(binding.authenticatedEmail);
    const expectedPhone = normalizeIndexedPhone(binding.authenticatedTelephone);
    const documents = await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(
      tenantVaultId,
      getEnvSectionId('device-licenses'),
    ) || [];
    for (const document of documents) {
      let license = document.content as DeviceLicense & Record<string, unknown> | undefined;
      if (!license || typeof license !== 'object' || !String(license.id || '').trim()) {
        try {
          license = await this.kmsService.unprotectConfidentialData<DeviceLicense & Record<string, unknown>>(
            document,
            tenantVaultId,
          );
        } catch {
          continue;
        }
      }
      if (String(license.status || '').trim() !== LICENSE_STATUS_ACTIVE
        || String(license.userClass || '').trim() !== LICENSE_USER_CLASS_INDIVIDUAL
        || String(license.authorizedSubjectDid || '').trim() !== subjectDid) continue;
      const licenseEmail = normalizeIndexedEmail(license.issuedToEmail);
      const licensePhone = normalizeIndexedPhone(license.issuedToPhone);
      if ((expectedEmail && licenseEmail === expectedEmail)
        || (expectedPhone && licensePhone === expectedPhone)) return;
    }

    throw new ManagerError(
      'Pre-SMART subject lookup requires an active subject licence bound to the protected profile contact.',
      IssueType.Forbidden,
    );
  }

  private async processFamilyPurgeEntry(job: JobRequest, entry: BundleEntry): Promise<BundleEntry | ErrorEntry> {
    const rawClaims = entry?.resource?.meta?.claims;
    const claims: ClaimsRecord | undefined = rawClaims ? (normalizeContextualizedClaims(rawClaims) as ClaimsRecord) : rawClaims;
    if (!claims) {
      throw new ManagerError('Malformed entry: missing meta.claims', IssueType.Required);
    }

    const requestedSector = (job.sector || claims[ClaimsServiceSchemaorg.category]) as Sector | undefined;
    if (!requestedSector || !job.tenantId) {
      throw new ManagerError('Job is missing tenantId or sector.', IssueType.Required);
    }
    const tenantVaultId = getTenantVaultId(requestedSector, job.tenantId);
    const tenantCollectionName = await this.tenantsCacheManager.getCollectionName(tenantVaultId);
    if (!tenantCollectionName) {
      throw new ManagerError(`Tenant not found in cache: '${tenantVaultId}'`, IssueType.NotFound);
    }

    const ownerPhones = splitIndexedPhones(claims['org.schema.Organization.owner.telephone'] as string | undefined);
    const ownerEmails = splitIndexedEmails(claims['org.schema.Organization.owner.email'] as string | undefined);
    this.assertOwnerDirectoryAuthorization(job, tenantVaultId, ownerPhones, ownerEmails);
    const requestedDocumentId = normalizeUuid(claims[ClaimsOrganizationSchemaorg.identifierValue]);
    const nickname = claims[ClaimsOrganizationSchemaorg.alternateName] as string | undefined;
    if ((ownerPhones.length === 0 && ownerEmails.length === 0) || (!nickname && !requestedDocumentId)) {
      throw new ManagerError(
        `Missing required claims for purge: one of '${ClaimsOrganizationSchemaorg.identifierValue}'/'${ClaimsOrganizationSchemaorg.alternateName}' and one of owner.telephone/owner.email`,
        IssueType.Required,
      );
    }

    const foundResult = requestedDocumentId
      ? await this.vaultRepository.get<ConfidentialStorageDoc>(tenantCollectionName, requestedDocumentId, INDIVIDUAL_SECTION)
      : await this.findFamilyRegistrationDoc(tenantCollectionName, ownerPhones, ownerEmails, nickname!);
    if (!foundResult) {
      throw new ManagerError('Family registration not found for purge.', IssueType.NotFound);
    }

    const familyContent = await this.kmsService.unprotectConfidentialData<FamilyRegistrationContent>(foundResult, tenantVaultId);
    const storedPhones = splitIndexedPhones(familyContent.claims[ClaimsOrganizationSchemaorg.ownerTelephone] as string | undefined);
    const storedEmails = splitIndexedEmails(familyContent.claims[ClaimsOrganizationSchemaorg.ownerEmail] as string | undefined);
    const ownsRecord = ownerPhones.some(value => storedPhones.includes(value)) || ownerEmails.some(value => storedEmails.includes(value));
    if (!ownsRecord) throw new ManagerError('Only the verified owner/controller may purge this individual.', IssueType.Forbidden);
    const storedReadiness = readIndividualRegistrationReadiness(familyContent.claims);
    if (familyContent.status === EntityLifecycleStatus.Pending && storedReadiness.isDraft) {
      await this.purgeIndividualSubjectData({
        tenantVaultId,
        tenantCollectionName,
        familyRecord: foundResult,
        familyContent,
        lifecycleClaims: claims,
      });
      return {
        type: 'Family-purge-response-v1.0',
        resource: { resourceType: ResourceTypesFhirR4.Organization, id: foundResult.id, meta: { claims: {
          [ClaimsOrganizationSchemaorg.identifierValue]: foundResult.id,
          [GatewayClaim.FamilyRegistrationStatus]: FamilyRegistrationStatus.DraftDeleted,
        } } },
        response: { status: '200' },
      };
    }
    if (familyContent.status !== EntityLifecycleStatus.Inactive) {
      throw new ManagerError('Family registration must be disabled before purge.', IssueType.Conflict);
    }

    await this.releaseFamilyLicenses(tenantVaultId, familyContent);
    await this.purgeIndividualSubjectData({
      tenantVaultId,
      tenantCollectionName,
      familyRecord: foundResult,
      familyContent,
      lifecycleClaims: claims,
    });

    return {
      type: 'Family-purge-response-v1.0',
      resource: { resourceType: ResourceTypesFhirR4.Organization, id: foundResult.id, meta: {
        claims: {
          ...(nickname ? { [ClaimsOrganizationSchemaorg.alternateName]: nickname } : {}),
          [GatewayClaim.FamilyRegistrationStatus]: FamilyRegistrationStatus.Purged,
        },
      } },
      response: { status: '200' },
    };
  }

  /**
   * Destructively removes one individual/family registration plus every
   * subject-scoped section and best-effort blob reference derived from it.
   */
  private async purgeIndividualSubjectData(params: {
    tenantVaultId: string;
    tenantCollectionName: string;
    familyRecord: ConfidentialStorageDoc;
    familyContent: FamilyRegistrationContent;
    lifecycleClaims?: ClaimsRecord;
  }): Promise<void> {
    const collectionNames = [...new Set([params.tenantVaultId, params.tenantCollectionName].filter(Boolean))];
    const subjectIdentifiers = this.collectFamilySubjectIdentifiers(params.familyContent, params.lifecycleClaims);

    for (const subjectIdentifier of subjectIdentifiers) {
      await this.purgeSubjectScopedSections(collectionNames, subjectIdentifier);
    }

    await this.deleteStoredRecordWithBlobs(
      params.tenantCollectionName,
      params.familyRecord.id,
      INDIVIDUAL_SECTION,
      params.familyRecord,
      params.familyContent as unknown as Record<string, any>,
    );
  }

  private collectFamilySubjectIdentifiers(
    content: FamilyRegistrationContent,
    lifecycleClaims?: ClaimsRecord,
  ): string[] {
    const claims = {
      ...(content?.claims || {}),
      ...(lifecycleClaims || {}),
    };
    const identifiers = [
      claims[ClaimsOrganizationSchemaorg.identifier],
      claims[ClaimsPersonSchemaorg.identifier],
      claims[ClaimsServiceSchemaorg.identifier],
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean);

    for (const resource of Array.isArray(content?.contained) ? content.contained : []) {
      const resourceId = String((resource as Record<string, unknown>)?.id || '').trim();
      if (resourceId) {
        identifiers.push(resourceId);
      }
    }

    return [...new Set(identifiers)];
  }

  private async purgeSubjectScopedSections(collectionNames: string[], subjectIdentifier: string): Promise<void> {
    const subjectHash = createHash('sha256').update(subjectIdentifier, 'utf8').digest('hex');

    for (const collectionName of collectionNames) {
      const sectionIds = await this.vaultRepository.getAllSections(collectionName);
      for (const sectionId of sectionIds) {
        if (!sectionId.startsWith(getEnvSectionId(`${SUBJECT_SECTION_INDIVIDUAL}_`)) || !sectionId.endsWith(subjectHash)) {
          continue;
        }

        const records = await this.vaultRepository.getContainersInSection<any>(collectionName, sectionId);
        for (const record of records) {
          const recordId = String(record?.id || '').trim();
          if (!recordId) {
            continue;
          }
          await this.deleteStoredRecordWithBlobs(collectionName, recordId, sectionId, record);
        }
      }
    }
  }

  private async deleteStoredRecordWithBlobs(
    collectionName: string,
    recordId: string,
    sectionId: string,
    record: Record<string, any>,
    additionalBlobReferenceSource?: Record<string, any>,
  ): Promise<void> {
    await this.deleteBlobReferencesFromRecord(record, additionalBlobReferenceSource);
    await this.vaultRepository.delete(collectionName, recordId, sectionId);
  }

  private async deleteBlobReferencesFromRecord(
    record: Record<string, any>,
    additionalBlobReferenceSource?: Record<string, any>,
  ): Promise<void> {
    if (!record || typeof record !== 'object') {
      return;
    }

    const blobRefs = [...new Set([
      ...this.collectBlobReferenceStrings(record),
      ...this.collectBlobReferenceStrings(additionalBlobReferenceSource),
    ])];
    for (const blobRef of blobRefs) {
      if (!blobRef || !this.storageAdapter.delete) {
        continue;
      }
      await this.storageAdapter.delete(blobRef).catch(() => undefined);
    }
  }

  private collectBlobReferenceStrings(value: unknown): string[] {
    if (!value || typeof value !== 'object') {
      return [];
    }

    if (Array.isArray(value)) {
      return value.flatMap((entry) => this.collectBlobReferenceStrings(entry));
    }

    const blobRefs: string[] = [];
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      if (typeof nestedValue === 'string' && (key === 'blobRef' || key.endsWith('#hash'))) {
        blobRefs.push(nestedValue);
      }
      blobRefs.push(...this.collectBlobReferenceStrings(nestedValue));
    }
    return blobRefs;
  }

  private async processFamilyDisableEntry(job: JobRequest, entry: BundleEntry): Promise<BundleEntry | ErrorEntry> {
    const rawClaims = entry?.resource?.meta?.claims;
    const claims: ClaimsRecord | undefined = rawClaims ? (normalizeContextualizedClaims(rawClaims) as ClaimsRecord) : rawClaims;
    if (!claims) {
      throw new ManagerError('Malformed entry: missing meta.claims', IssueType.Required);
    }

    const requestedSector = (job.sector || claims[ClaimsServiceSchemaorg.category]) as Sector | undefined;
    if (!requestedSector || !job.tenantId) {
      throw new ManagerError('Job is missing tenantId or sector.', IssueType.Required);
    }
    const tenantVaultId = getTenantVaultId(requestedSector, job.tenantId);
    const tenantCollectionName = await this.tenantsCacheManager.getCollectionName(tenantVaultId);
    if (!tenantCollectionName) {
      throw new ManagerError(`Tenant not found in cache: '${tenantVaultId}'`, IssueType.NotFound);
    }

    const ownerPhones = splitIndexedPhones(claims['org.schema.Organization.owner.telephone'] as string | undefined);
    const ownerEmails = splitIndexedEmails(claims['org.schema.Organization.owner.email'] as string | undefined);
    this.assertOwnerDirectoryAuthorization(job, tenantVaultId, ownerPhones, ownerEmails);
    const nickname = claims[ClaimsOrganizationSchemaorg.alternateName] as string | undefined;
    if ((ownerPhones.length === 0 && ownerEmails.length === 0) || !nickname) {
      throw new ManagerError(
        `Missing required claims for disable: '${ClaimsOrganizationSchemaorg.alternateName}' and one of owner.telephone/owner.email`,
        IssueType.Required,
      );
    }

    const foundResult = await this.findFamilyRegistrationDoc(tenantCollectionName, ownerPhones, ownerEmails, nickname);
    if (!foundResult) {
      throw new ManagerError('Family registration not found for disable.', IssueType.NotFound);
    }

    const familyContent = await this.kmsService.unprotectConfidentialData<FamilyRegistrationContent>(foundResult, tenantVaultId);
    familyContent.status = EntityLifecycleStatus.Inactive;
    const updatedDoc: ConfidentialStorageDoc = {
      ...foundResult,
      status: EntityLifecycleStatus.Inactive,
      sequence: (foundResult.sequence || 0) + 1,
      content: familyContent,
    };
    const secureUpdatedDoc = await this.kmsService.protectConfidentialData(updatedDoc, tenantVaultId);
    await this.vaultRepository.put(tenantCollectionName, [secureUpdatedDoc], INDIVIDUAL_SECTION);

    return {
      type: 'Family-disable-response-v1.0',
      resource: { resourceType: ResourceTypesFhirR4.Organization, id: foundResult.id, meta: {
        claims: {
          [ClaimsOrganizationSchemaorg.alternateName]: nickname,
          [GatewayClaim.FamilyRegistrationStatus]: FamilyRegistrationStatus.Disabled,
        },
      } },
      response: { status: '200' },
    };
  }

  private async releaseFamilyLicenses(
    tenantVaultId: string,
    familyContent: FamilyRegistrationContent,
  ): Promise<void> {
    const activationCode = String((familyContent.claims as any)['org.schema.IndividualProduct.serialNumber'] || '').trim();
    const email = normalizeIndexedEmail(String(
      familyContent.claims[ClaimsPersonSchemaorg.email]
      || familyContent.claims[ClaimsOrganizationSchemaorg.ownerEmail]
      || '',
    ));

    const licenseDocs =
      (await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(tenantVaultId, DEVICE_LICENSE_SECTION)) || [];
    const updatedDocs: ConfidentialStorageDoc[] = [];

    for (const doc of licenseDocs) {
      const license = doc.content as (DeviceLicense & Record<string, any>) | undefined;
      const userClass = String(license?.userClass || '');
      if (!license || (userClass !== LICENSE_USER_CLASS_INDIVIDUAL && userClass !== LICENSE_USER_CLASS_CUSTOMER)) {
        continue;
      }

      const matchesActivationCode = activationCode && String(license.activationCode || '').trim() === activationCode;
      const matchesInviteEmail =
        email && normalizeIndexedEmail(String(license.issuedToEmail || '')) === email;
      if (!matchesActivationCode && !matchesInviteEmail) {
        continue;
      }

      const resetLicense: DeviceLicense & Record<string, any> = {
        ...license,
        status: LICENSE_STATUS_AVAILABLE,
      };
      delete resetLicense.subjectId;
      delete resetLicense.activationCode;
      delete resetLicense.issuedAt;
      delete resetLicense.issuedToEmail;
      delete resetLicense.issuedToRole;
      delete resetLicense.activatedAt;
      delete resetLicense.deviceId;
      delete resetLicense.deviceInfo;

      updatedDocs.push({
        ...doc,
        status: LICENSE_STATUS_AVAILABLE,
        sequence: (doc.sequence || 0) + 1,
        content: resetLicense,
      });
    }

    if (updatedDocs.length > 0) {
      await this.vaultRepository.put(tenantVaultId, updatedDocs, DEVICE_LICENSE_SECTION);
    }
  }

  private async findFamilyRegistrationDoc(
    tenantCollectionName: string,
    ownerPhones: string[],
    ownerEmails: string[],
    nickname: string,
  ): Promise<ConfidentialStorageDoc | undefined> {
    for (const phone of ownerPhones) {
      const results = await this.vaultRepository.query(tenantCollectionName, {
        sectionId: INDIVIDUAL_SECTION,
        where: [
          { name: 'org.schema.Organization.owner.telephone', value: phone },
          { name: ClaimsOrganizationSchemaorg.alternateName, value: nickname },
        ],
      });
      if (results.length > 0) {
        return results[0] as ConfidentialStorageDoc;
      }
    }
    for (const email of ownerEmails) {
      const results = await this.vaultRepository.query(tenantCollectionName, {
        sectionId: INDIVIDUAL_SECTION,
        where: [
          { name: 'org.schema.Organization.owner.email', value: email },
          { name: ClaimsOrganizationSchemaorg.alternateName, value: nickname },
        ],
      });
      if (results.length > 0) {
        return results[0] as ConfidentialStorageDoc;
      }
    }
    return undefined;
  }

  /**
   * Returns every individual Organization indexed to an exact owner contact.
   *
   * This is the server-side card directory used after the application has
   * verified the email/telephone. It never scans all individuals and it does
   * not return wallet/device material. Results are deduplicated because one
   * Organization may carry both verified contact claims.
   */
  private async findFamilyRegistrationDocsByOwner(
    tenantCollectionName: string,
    ownerPhones: string[],
    ownerEmails: string[],
  ): Promise<ConfidentialStorageDoc[]> {
    const found = new Map<string, ConfidentialStorageDoc>();
    for (const [name, values] of [
      ['org.schema.Organization.owner.telephone', ownerPhones],
      ['org.schema.Organization.owner.email', ownerEmails],
    ] as const) {
      for (const value of values) {
        const results = await this.vaultRepository.query(tenantCollectionName, {
          sectionId: INDIVIDUAL_SECTION,
          where: [{ name, value }],
        });
        for (const result of results) found.set(result.id, result as ConfidentialStorageDoc);
      }
    }
    return [...found.values()];
  }

  /** Builds the browser/BFF-safe searchset for an owner-directory lookup. */
  private async buildOwnedFamilyDirectoryResult(
    tenantVaultId: string,
    tenantCollectionName: string,
    ownerPhones: string[],
    ownerEmails: string[],
  ): Promise<BundleEntry> {
    const documents = await this.findFamilyRegistrationDocsByOwner(
      tenantCollectionName,
      ownerPhones,
      ownerEmails,
    );
    const entries = [];
    for (const document of documents) {
      const content = await this.kmsService.unprotectConfidentialData<FamilyRegistrationContent>(document, tenantVaultId);
      const claims = content?.claims || {};
      const storedPhones = splitIndexedPhones(claims['org.schema.Organization.owner.telephone'] as string | undefined);
      const storedEmails = splitIndexedEmails(claims['org.schema.Organization.owner.email'] as string | undefined);
      const matchesVerifiedContact = storedPhones.some(value => ownerPhones.includes(value))
        || storedEmails.some(value => ownerEmails.includes(value));
      if (!matchesVerifiedContact) continue;
      const isActive = content?.status === EntityLifecycleStatus.Active;
      const pendingReadiness = isActive ? undefined : readIndividualRegistrationReadiness(claims);
      const isPrivateDraft = pendingReadiness?.isDraft === true;
      entries.push({
        fullUrl: `Organization/${document.id}`,
        resource: {
          resourceType: 'Organization',
          id: document.id,
          meta: {
            claims: {
              ...claims,
              [GatewayClaim.FamilyRegistrationStatus]: isActive
                ? FamilyRegistrationStatus.Existing
                : isPrivateDraft
                  ? FamilyRegistrationStatus.DraftSaved
                  : FamilyRegistrationStatus.ResumeRequired,
              ...(isPrivateDraft
                ? { [GatewayClaim.FamilyRegistrationMissingFields]: pendingReadiness!.missing }
                : {}),
            },
          },
        },
      });
    }
    return {
      type: 'Family-owner-directory-result-v1.0',
      resource: { resourceType: ResourceTypesFhirR4.Bundle, type: 'searchset', entry: entries, meta: {
        claims: { [GatewayClaim.FamilyRegistrationResultCount]: String(entries.length) },
      } } as any,
      response: { status: '200' },
    };
  }

  private async handleServiceAttachment(service?: IncludedResource): Promise<IncludedResource | undefined> {
    if (!service) return undefined;
    let termsOfService = service.meta.claims[ClaimsServiceSchemaorg.termsOfService] as string | undefined;
    if (termsOfService && !termsOfService.startsWith('http')) {
      try {
        if (termsOfService.startsWith('data:')) {
          const parts = termsOfService.split(',');
          if (parts.length !== 2) throw new Error('Malformed data URL.');
          termsOfService = parts[1];
        }
        const pdfBytes = Buffer.from(termsOfService, 'base64');
        const uploadResult = await this.storageAdapter.upload(pdfBytes, 'application/pdf');
        if (!uploadResult) throw new Error('Storage adapter returned undefined result.');
        const { publicUrl } = uploadResult;
        service.meta.claims[ClaimsServiceSchemaorg.termsOfService] = publicUrl;
        (service.meta.claims as any)[`${ClaimsServiceSchemaorg.termsOfService}#hash`] = createHash('sha256')
          .update(pdfBytes)
          .digest('hex');
      } catch (e: any) {
        throw new ManagerError(`Error processing service attachment: ${e.message}`, IssueType.Invalid);
      }
    }
    return service;
  }

  private extractResources(claims: ClaimsRecord, environment?: string) {
    const resourceTypes = ['Organization', 'Person', 'Service'] as const;
    const resources: Record<string, IncludedResource> = {};

    for (const type of resourceTypes) {
      const resourceClaims: Record<string, any> = { '@type': type };
      let claimFound = false;
      for (const key in claims) {
        if (key.startsWith(`org.schema.${type}.`)) {
          resourceClaims[key] = claims[key];
          claimFound = true;
        }
      }
      if (claimFound) {
        const identifierClaim = resourceClaims[`org.schema.${type}.identifier`];
        const resourceId = determineResourceId(identifierClaim, environment);
        resources[type.toLowerCase()] = {
          id: resourceId,
          type,
          meta: { claims: resourceClaims },
        } as IncludedResource;
      }
    }

    // Individual controllers may authenticate with either verified contact.
    // Requiring a telephone here misclassifies Google/email-only cards as legal
    // organizations and incorrectly demands a separate Person resource.
    const isIndividualOrg = !!(
      claims['org.schema.Organization.owner.telephone']
      || claims['org.schema.Organization.owner.email']
    );
    if (!resources.organization || !resources.service || (!resources.person && !isIndividualOrg)) {
      throw new ManagerError(
        'Incomplete claims: Organization and Service are required. Person is required for legal orgs, but not for individual orgs.',
        IssueType.Required
      );
    }
    // Return with person if present, else only org and service
    return {
      organization: resources.organization,
      ...(resources.person ? { person: resources.person } : {}),
      service: resources.service,
    } as any;
  }
}

/** Emits the opaque public subject DID without exposing its private identifier type. */
function buildCanonicalIndividualSubjectDid(providerDidWeb: string, privateSubjectId: string): string {
  const provider = String(providerDidWeb || '').trim();
  if (!provider) throw new Error('A provider DID is required for the individual subject DID.');
  const secureSubjectId = buildSecureIdValueIndividual({
    secureIdTypeIndividual: SecureIdTypesIndividual.Uuid,
    privateIdValueIndividual: privateSubjectId,
  });
  return `${provider}:individual:multibase:${secureSubjectId}`;
}

/** Preserves a canonical controller UUID or creates one for legacy requests. */
function canonicalControllerUuidOrNew(value: unknown): string {
  const hexadecimal = normalizeUuid(String(value || '').trim());
  if (!hexadecimal) return uuidv4();
  return [
    hexadecimal.slice(0, 8),
    hexadecimal.slice(8, 12),
    hexadecimal.slice(12, 16),
    hexadecimal.slice(16, 20),
    hexadecimal.slice(20),
  ].join('-');
}
