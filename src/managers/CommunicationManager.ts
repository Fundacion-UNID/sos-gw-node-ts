// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/CommunicationManager.ts
// Description: Manager for handling business logic related to FHIR Communications.
import { FhirDataTypes } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { HttpRequestMethods } from 'gdc-common-utils-ts/constants/http';
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';

import { CommMsgExtended, DataEntry, FhirCommunication } from 'gdc-common-utils-ts/models/comm';
import {
  DataCollectionIds,
  FhirResourceTypeDataCollections,
  HealthcareBasicSections,
  ResourceTypesFhirR4,
} from 'gdc-common-utils-ts/constants/index';
import { CommunicationClaim } from 'gdc-common-utils-ts/models/interoperable-claims/communication-claims';
import { CompositionAttesterModes, CompositionClaim } from 'gdc-common-utils-ts/models/interoperable-claims/composition-claims';
import { Format } from 'gdc-common-utils-ts/constants/Schemas';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { claimsToContentCid } from 'gdc-common-utils-ts/utils/fhir-cid';
import {
  buildCommunicationParticipantIndexAttributes,
  CommunicationParticipantIndexNames,
  matchesCommunicationParticipantSearch,
  paginateCommunicationParticipantMatches,
  parseCommunicationParticipantSearchCriteria,
} from 'gdc-common-utils-ts/utils/communication-participant-search';
import { SearchBundleTypes } from 'gdc-common-utils-ts/utils/fhir-search';
import { normalizeClaimsFromFhirResource } from 'gdc-common-utils-ts/utils/interoperable-resource-operation';
import { compositionFhirR4ToFlat } from 'gdc-common-utils-ts/convert/convert-composition';
import { buildConfidentialDocumentIndexedAttributes } from 'gdc-common-utils-ts/utils/confidential-document-provenance';
import { requireClaimsOnlyResourceShape } from '../utils/fhir-flat-claims';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { BundleJsonApi, BundleEntryResponse, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import type { OperationOutcome } from 'gdc-common-utils-ts/models/operation-outcome';
import { determineResourceId } from '../utils/resource';
import { v4 as uuidv4 } from 'uuid';
import { IJobProcessor } from './registry';
import type { ITenantsManager } from './ITenantsManager';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { getTenantVaultId } from '../utils/tenant';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { getSubjectScopedSectionId } from '../utils/individual-sections';
import { getEnvSectionId } from '../utils/section-env';
import { createHash } from 'crypto';
import { encodeMultibase58btc } from 'gdc-common-utils-ts/utils/multibase58';
import { applyFhirCidVersioningToEntry, fhirResourceToCid } from '../utils/fhir-versioning';
import { canonicalizeFhirClaims, getClaimValue, normalizeContextualizedClaims } from '../utils/claims';
import { persistConsentRuleAndAttachment } from '../utils/consent-storage';
import { SUBJECT_SECTION_DIGITAL_TWIN, SUBJECT_SECTION_INDIVIDUAL } from '../constants/domain';
import { GatewayResponseEntryTypes } from '../shared/gateway-response-types';
import {
  getOrCreateDigitalTwinSubjectId,
  isFinalizedDigitalTwinResearchRecord,
  isDigitalTwinResearchResourceType,
  isProfessionallyAttestedResearchRecord,
  resolveAndProjectClaimsForDigitalTwin,
} from '../utils/digital-twin-research-projection';
import { isDigitalTwinSecondaryUseEnabled } from '../utils/digital-twin-secondary-use';
import { getAuthenticatedJobActorIdentifiers } from '../utils/authenticated-job-actor';
import { ClaimConsent, ConsentStatuses } from 'gdc-common-utils-ts/models/consent-rule';
import { canonicalizeBundleEntryMetadata } from '../utils/canonical-entry-metadata';
import {
  FhirIpsCreatorKinds,
  resolveClinicalCreatorBinding,
  type AuthenticatedClinicalCreatorEvidence,
  type ClinicalCreatorBinding,
} from 'gdc-common-utils-ts/utils/fhir-ips-creator-identity';
import {
  ClinicalResourceReplacementDecision,
  evaluateClinicalResourceReplacement,
  resolveClinicalDocumentAuthorOrganization,
  type ClinicalDocumentAuthorOrganization,
} from 'gdc-common-utils-ts/utils/clinical-resource-replacement';
import { getClinicalCreatorBindingsSectionId } from '../utils/clinical-creator-binding';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { EntityLifecycleStatus } from '../gdc-backend-utils-node/models/enums';
import type { IBlockchainAdapter } from '../adapters/IBlockchainAdapter';
import { ClinicalEvidenceChaincode } from '../utils/ledger';
import {
  buildResearchAssetVersionMapping,
  resolveResearchDataChannel,
  type ResearchAssetVersionMapping,
} from '../utils/research-asset-versioning';
import { createOperationOutcome } from '../utils/outcome';

type SupportedProjectedResourceType =
  | 'MedicationStatement'
  | 'Observation'
  | 'AllergyIntolerance'
  | 'Condition'
  | 'DeviceUseStatement'
  | 'Flag'
  | 'Procedure'
  | 'ImagingStudy'
  | 'Immunization'
  | 'ImmunizationRecommendation'
  | 'Medication'
  | 'DocumentReference'
  | 'RelatedPerson'
  | 'DiagnosticReport'
  | 'CarePlan'
  | 'Encounter'
  | 'EncounterHistory'
  | 'AdverseEvent'
  | 'Consent';

type ProjectionConfig = {
  collectionId: string;
  subjectClaimKeys: string[];
  identifierClaimKeys: string[];
};

type ResolvedCommunicationAttachment = {
  transportAttachment: Record<string, any>;
  documentReference?: Record<string, any>;
  documentAttachment: Record<string, any>;
};

const PROJECTED_RESOURCE_CONFIG: Record<SupportedProjectedResourceType, ProjectionConfig> = {
  MedicationStatement: {
    collectionId: FhirResourceTypeDataCollections[ResourceTypesFhirR4.MedicationStatement],
    subjectClaimKeys: ['MedicationStatement.subject', 'MedicationStatement.patient'],
    identifierClaimKeys: ['MedicationStatement.identifier', 'MedicationStatement.identifier.value'],
  },
  Observation: {
    collectionId: FhirResourceTypeDataCollections[ResourceTypesFhirR4.Observation],
    subjectClaimKeys: ['Observation.subject', 'Observation.patient'],
    identifierClaimKeys: ['Observation.identifier', 'Observation.identifier.value'],
  },
  AllergyIntolerance: {
    collectionId: FhirResourceTypeDataCollections[ResourceTypesFhirR4.AllergyIntolerance],
    subjectClaimKeys: ['AllergyIntolerance.patient', 'AllergyIntolerance.subject'],
    identifierClaimKeys: ['AllergyIntolerance.identifier', 'AllergyIntolerance.identifier.value'],
  },
  Condition: {
    collectionId: FhirResourceTypeDataCollections[ResourceTypesFhirR4.Condition],
    subjectClaimKeys: ['Condition.subject', 'Condition.patient'],
    identifierClaimKeys: ['Condition.identifier', 'Condition.identifier.value'],
  },
  DeviceUseStatement: {
    collectionId: FhirResourceTypeDataCollections[ResourceTypesFhirR4.DeviceUseStatement],
    subjectClaimKeys: ['DeviceUseStatement.subject', 'DeviceUseStatement.patient'],
    identifierClaimKeys: ['DeviceUseStatement.identifier', 'DeviceUseStatement.identifier.value'],
  },
  Flag: {
    collectionId: FhirResourceTypeDataCollections[ResourceTypesFhirR4.Flag],
    subjectClaimKeys: ['Flag.subject', 'Flag.patient'],
    identifierClaimKeys: ['Flag.identifier', 'Flag.identifier.value'],
  },
  Procedure: {
    collectionId: FhirResourceTypeDataCollections[ResourceTypesFhirR4.Procedure],
    subjectClaimKeys: ['Procedure.subject', 'Procedure.patient'],
    identifierClaimKeys: ['Procedure.identifier', 'Procedure.identifier.value'],
  },
  ImagingStudy: {
    collectionId: FhirResourceTypeDataCollections[ResourceTypesFhirR4.ImagingStudy],
    subjectClaimKeys: ['ImagingStudy.subject', 'ImagingStudy.patient'],
    identifierClaimKeys: ['ImagingStudy.identifier', 'ImagingStudy.identifier.value'],
  },
  Immunization: {
    collectionId: FhirResourceTypeDataCollections[ResourceTypesFhirR4.Immunization],
    subjectClaimKeys: ['Immunization.patient', 'Immunization.subject'],
    identifierClaimKeys: ['Immunization.identifier', 'Immunization.identifier.value'],
  },
  ImmunizationRecommendation: {
    collectionId: 'immunization-recommendations',
    subjectClaimKeys: ['ImmunizationRecommendation.patient', 'ImmunizationRecommendation.subject'],
    identifierClaimKeys: ['ImmunizationRecommendation.identifier', 'ImmunizationRecommendation.identifier.value'],
  },
  Medication: {
    collectionId: 'medication-products',
    subjectClaimKeys: ['Medication.subject'],
    identifierClaimKeys: ['Medication.identifier', 'Medication.identifier.value'],
  },
  DocumentReference: {
    collectionId: 'document-references',
    subjectClaimKeys: ['DocumentReference.subject', 'DocumentReference.patient'],
    identifierClaimKeys: ['DocumentReference.identifier', 'DocumentReference.identifier.value'],
  },
  RelatedPerson: {
    collectionId: FhirResourceTypeDataCollections[ResourceTypesFhirR4.RelatedPerson],
    subjectClaimKeys: ['RelatedPerson.patient', 'RelatedPerson.subject'],
    identifierClaimKeys: ['RelatedPerson.identifier', 'RelatedPerson.identifier.value'],
  },
  DiagnosticReport: {
    collectionId: FhirResourceTypeDataCollections[ResourceTypesFhirR4.DiagnosticReport],
    subjectClaimKeys: ['DiagnosticReport.subject', 'DiagnosticReport.patient'],
    identifierClaimKeys: ['DiagnosticReport.identifier', 'DiagnosticReport.identifier.value'],
  },
  CarePlan: {
    collectionId: FhirResourceTypeDataCollections[ResourceTypesFhirR4.CarePlan],
    subjectClaimKeys: ['CarePlan.subject', 'CarePlan.patient'],
    identifierClaimKeys: ['CarePlan.identifier', 'CarePlan.identifier.value'],
  },
  Encounter: {
    collectionId: FhirResourceTypeDataCollections[ResourceTypesFhirR4.Encounter],
    subjectClaimKeys: ['Encounter.subject', 'Encounter.patient'],
    identifierClaimKeys: ['Encounter.identifier', 'Encounter.identifier.value'],
  },
  EncounterHistory: {
    collectionId: DataCollectionIds.encounters,
    subjectClaimKeys: ['EncounterHistory.subject', 'EncounterHistory.patient'],
    identifierClaimKeys: ['EncounterHistory.identifier', 'EncounterHistory.identifier.value'],
  },
  AdverseEvent: {
    collectionId: FhirResourceTypeDataCollections[ResourceTypesFhirR4.AdverseEvent],
    subjectClaimKeys: ['AdverseEvent.subject', 'AdverseEvent.patient'],
    identifierClaimKeys: ['AdverseEvent.identifier', 'AdverseEvent.identifier.value'],
  },
  Consent: {
    collectionId: FhirResourceTypeDataCollections[ResourceTypesFhirR4.Consent],
    subjectClaimKeys: ['Consent.subject', 'Consent.patient'],
    identifierClaimKeys: ['Consent.identifier', 'Consent.identifier.value'],
  },
};

/** Search-only tags accepted from a metadata-only document projection. */
const MINIMAL_DOCUMENT_INDEX_TAG_CLAIMS: Partial<Record<SupportedProjectedResourceType, ReadonlySet<string>>> = {
  Immunization: new Set([
    'Immunization.date', 'Immunization.status', 'Immunization.language',
    'Immunization.reason-code', 'Immunization.vaccine-code',
  ]),
  Observation: new Set(['Observation.date', 'Observation.status', 'Observation.language']),
  AllergyIntolerance: new Set([
    'AllergyIntolerance.onset-date', 'AllergyIntolerance.criticality',
    'AllergyIntolerance.clinical-status', 'AllergyIntolerance.category',
    'AllergyIntolerance.code', 'AllergyIntolerance.language',
  ]),
  Condition: new Set([
    'Condition.onset-date', 'Condition.abatement-date', 'Condition.clinical-status',
    'Condition.severity', 'Condition.code', 'Condition.language',
  ]),
  MedicationStatement: new Set([
    'MedicationStatement.effective', 'MedicationStatement.status',
    'MedicationStatement.medication', 'MedicationStatement.language',
  ]),
};

const FHIR_SUBSETTED_TAG_SYSTEM = 'http://terminology.hl7.org/CodeSystem/v3-ObservationValue';
const FHIR_SUBSETTED_TAG_CODE = 'SUBSETTED';

interface CommunicationManagerOptions {
  tenantsCacheManager: ITenantsManager;
  vaultRepository: IVaultRepository;
  kmsService: IKmsService;
  compositionManager?: IJobProcessor;
  individualManager?: IJobProcessor;
  taskManager?: IJobProcessor;
  blockchainAdapter?: IBlockchainAdapter;
}

const COMMUNICATION_RESOURCE_TYPE = 'Communication' as const;
const COMMUNICATION_ENTRY_TYPE = 'CommMsgExtended' as const;
const COMMUNICATION_SECTION_NAME = DataCollectionIds.communications;
const FHIR_PARAMETERS_RESOURCE_TYPE = ResourceTypesFhirR4.Parameters;
const SEARCH_RESPONSE_ENTRY_TYPE = GatewayResponseEntryTypes.CommunicationSearch;
const COMMUNICATION_SECTION_PREFIX = getEnvSectionId(`${SUBJECT_SECTION_INDIVIDUAL}_${COMMUNICATION_SECTION_NAME}_`);

/**
 * Processes the canonical `Communication` transport envelope used by the
 * operational `individual` flows.
 *
 * Architectural intent:
 * - `individual` is the operational subject-index plane.
 * - The public application/BFF boundary for subject-index I/O is the actor
 *   facade that submits and polls `Communication`; it is not one direct route
 *   per clinical resource or operation.
 * - `Communication` carries the auditable request envelope and may
 *   embed references to:
 *   - `Subject/$summary` as GW's internal canonical summary operation
 *   - `Subject/_search` for structured subject-location requests
 *   - `Bundle/_search` for document/section retrieval
 *
 * The same manager also projects attached document content into internal
 * subject-scoped storage sections so later summary/document retrieval can be
 * resolved deterministically.
 *
 * Persistence invariant: an API Communication is validated from its flat
 * `resource.meta.claims`; native R4 input is projected to the same flat map at
 * the import boundary. The channel record encrypts only `content: { claims }`
 * and all equality indexes are protected before storage and comparison.
 * Historical nested Communication records fail closed until an explicit,
 * recoverable migration is run.
 *
 * Important boundary:
 * - the operation references above are not endpoints that portal code should
 *   construct or invoke directly
 * - `individual` is for operational subject reads and document retrieval.
 * - `digitaltwin` is a different plane with different search semantics.
 * - `digitaltwin` should not be documented as "the same thing as individual
 *   but under another path".
 */
export class CommunicationManager implements IJobProcessor {
  private readonly tenantsCacheManager: ITenantsManager;
  private readonly vaultRepository: IVaultRepository;
  private readonly kmsService: IKmsService;
  private readonly compositionManager?: IJobProcessor;
  private readonly individualManager?: IJobProcessor;
  private readonly taskManager?: IJobProcessor;
  private readonly blockchainAdapter?: IBlockchainAdapter;

  constructor({ tenantsCacheManager, vaultRepository, kmsService, compositionManager, individualManager, taskManager, blockchainAdapter }: CommunicationManagerOptions) {
    this.tenantsCacheManager = tenantsCacheManager;
    this.vaultRepository = vaultRepository;
    this.kmsService = kmsService;
    this.compositionManager = compositionManager;
    this.individualManager = individualManager;
    this.taskManager = taskManager;
    this.blockchainAdapter = blockchainAdapter;
  }

  /**
   * Processes a job request containing FHIR Communication resources.
   * It iterates through the input entries, converts them, and prepares them for storage/delivery.
   * @param job The job to process.
   * @returns A promise that resolves to a payload response containing the converted messages.
   */
  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    if (job.action === '_search') {
      return this.processSearch(job);
    }

    const bundleEntries: (BundleEntryResponse | ErrorEntry)[] = [];
    const now = Math.floor(Date.now() / 1000);

    if (!job.content) {
      throw new Error('Job content is missing');
    }

    const body = job.content.body as any;
    const entries: any[] =
      (Array.isArray(body?.data) && body.data) ||
      (Array.isArray(body?.entry) && body.entry) ||
      [body];

    for (const entry of entries) {
      try {
        const fhirResource = this.resolveCommunicationResource(entry);

        if (!fhirResource) {
          throw new Error('Malformed entry: missing resource or resource.meta.claims');
        }
        
        if (fhirResource.resourceType !== COMMUNICATION_RESOURCE_TYPE) {
          console.warn(`Skipping resource of type ${fhirResource.resourceType}`);
          continue;
        }

        const serverDid = await this.tenantsCacheManager.getTenantDid(getTenantVaultId(job.sector as string, job.tenantId as string));
        if (!serverDid) {
            throw new Error(`Could not determine server DID for tenant '${job.tenantId}'.`);
        }
        const commMsg = this.convertCommunicationEntryToCommMsg(
          job.content.thid,
          serverDid,
          entry,
          fhirResource,
        );
        await this.persistCommunicationChannelRecord(job, entry as any, fhirResource, commMsg);
        const projectsAttachedClinicalState = this.shouldProjectAttachedClinicalState(entry, fhirResource);
        if (projectsAttachedClinicalState) {
          await this.persistCompositionProjectionFromCommunication(job, entry as any, fhirResource, serverDid);
          await this.persistDocumentReferenceProjectionFromCommunication(job, entry as any, fhirResource);
        }
        const clinicalBatchResponses = projectsAttachedClinicalState
          ? await this.persistProjectedResourcesFromCommunication(job, entry as any, fhirResource)
          : [];

        const embeddedSearchResponseEntries = projectsAttachedClinicalState
          ? await this.executeEmbeddedSearchRequest(job, entry, fhirResource)
          : undefined;
        if (embeddedSearchResponseEntries && embeddedSearchResponseEntries.length > 0) {
          bundleEntries.push(...embeddedSearchResponseEntries);
          continue;
        }

        if (clinicalBatchResponses.length > 0) {
          bundleEntries.push(...clinicalBatchResponses);
          continue;
        }

        const identifierClaim =
          (entry as any)?.resource?.meta?.claims?.[CommunicationClaim.Identifier] ??
          (entry as any)?.resource?.id;
        const resourceId = determineResourceId(identifierClaim, process.env.NODE_ENV);
        
        bundleEntries.push({
          response: { status: String(HttpStatusCodes.Ok) },
          id: resourceId,
          type: COMMUNICATION_ENTRY_TYPE,
          resource: commMsg,
        });

      } catch (error) {
        const diagnostics = error instanceof Error ? error.message : 'Unknown error during conversion.';
        const identifierClaim =
          (entry as any)?.resource?.meta?.claims?.[CommunicationClaim.Identifier] ??
          (entry as any)?.resource?.id;
        const resourceId = determineResourceId(identifierClaim, process.env.NODE_ENV);
        bundleEntries.push({
          response: {
            status: String(HttpStatusCodes.InternalServerError),
            outcome: {
              resourceType: ResourceTypesFhirR4.OperationOutcome,
              issue: [{
                severity: 'error',
                code: 'processing',
                diagnostics,
                details: { text: diagnostics },
              }],
            }
          },
          id: resourceId,
          type: GatewayResponseEntryTypes.OperationOutcome,
          ...canonicalizeBundleEntryMetadata(entry.meta as Record<string, unknown> | undefined),
        });
      }
    }

    const responseBundle: BundleJsonApi<BundleEntryResponse | ErrorEntry> = {
      resourceType: ResourceTypesFhirR4.Bundle,
      type: `${job.action}-response`, // FHIR based: batch-resonse, transaction-response
      data: bundleEntries,
    };
    
    const tenantVaultId = getTenantVaultId(job.sector as string, job.tenantId as string);
    const serverDid = await this.tenantsCacheManager.getTenantDid(tenantVaultId);
    if (!serverDid) {
      // This is a critical configuration error. The tenant is not in the cache.
      // We cannot issue a response without a valid DID.
      throw new Error(`Could not determine server DID for tenant '${job.tenantId}'.`);
    }

    // The audience of our response should be the issuer of the request
    const aud = job.content.meta?.bearer?.jwt?.payload?.iss || '';

    const result: IDecodedDidcommPayload = {
      jti: uuidv4(),
      iss: serverDid,
      aud: aud,
      exp: now + 300, // 5 minutes expiration
      thid: job.content.thid,
      type: 'api+json',
      body: responseBundle,
    };
    return result;
  }

  private async processSearch(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const now = Math.floor(Date.now() / 1000);
    const tenantVaultId = getTenantVaultId(job.sector as string, job.tenantId as string);
    const serverDid = await this.tenantsCacheManager.getTenantDid(tenantVaultId);
    if (!serverDid) {
      throw new Error(`Could not determine server DID for tenant '${job.tenantId}'.`);
    }

    const criteria = parseCommunicationParticipantSearchCriteria(
      this.extractSearchBody(job),
    );
    const records = await this.searchCommunicationChannelRecords(tenantVaultId, criteria);
    const pagedRecords = paginateCommunicationParticipantMatches(records, criteria);
    const data: Array<BundleEntryResponse | ErrorEntry> = pagedRecords.map((record) => ({
      response: { status: String(HttpStatusCodes.Ok) },
      id: this.normalizeOptionalString(record.id) || determineResourceId(record[CommunicationClaim.Identifier], process.env.NODE_ENV),
      type: COMMUNICATION_ENTRY_TYPE,
      resource: {
        resourceType: ResourceTypesFhirR4.Communication,
        id: this.normalizeOptionalString(record.id)
          || this.normalizeOptionalString(record[CommunicationClaim.Identifier])
          || determineResourceId(record?.thid, process.env.NODE_ENV),
        meta: {
          claims: this.buildSearchResponseClaims(record),
        },
      },
    }));

    const responseBundle: BundleJsonApi<BundleEntryResponse | ErrorEntry> = {
      resourceType: ResourceTypesFhirR4.Bundle,
      type: SearchBundleTypes.SearchResponse,
      total: records.length,
      data,
    };

    return {
      jti: uuidv4(),
      iss: serverDid,
      aud: job.content?.meta?.bearer?.jwt?.payload?.iss || '',
      exp: now + 300,
      thid: this.normalizeOptionalString(job.content?.thid) || uuidv4(),
      type: 'api+json',
      body: responseBundle,
    };
  }

  private async executeEmbeddedSearchRequest(
    job: JobRequest,
    entry: any,
    fhirResource: FhirCommunication,
  ): Promise<Array<BundleEntryResponse | ErrorEntry> | undefined> {
    const references = this.buildCommunicationContentReferences(job, entry, fhirResource)
      .filter((reference) => this.isEmbeddedSearchReference(reference));
    if (references.length === 0) return undefined;

    const responseEntries: Array<BundleEntryResponse | ErrorEntry> = [];
    for (const reference of references) {
      const parsed = this.parseEmbeddedSearchReference(reference, job, entry, fhirResource);
      if (!parsed) continue;
      const targetManager = parsed.resourceType === 'Subject' && parsed.action === '_search'
        ? this.individualManager
        : this.compositionManager;
      if (!targetManager) continue;

      const syntheticJob: JobRequest = {
        ...job,
        section: parsed.section,
        format: parsed.format,
        resourceType: parsed.resourceType,
        action: parsed.action,
        content: {
          ...(job.content as any),
          body: parsed.body,
        } as any,
      };

      const searchResponse = await targetManager.process(syntheticJob);
      const searchEntries = Array.isArray((searchResponse.body as any)?.data)
        ? ((searchResponse.body as any).data as Array<BundleEntryResponse | ErrorEntry>)
        : [];
      responseEntries.push(...searchEntries);
    }

    return responseEntries.length > 0 ? responseEntries : undefined;
  }

  private isEmbeddedSearchReference(reference: string): boolean {
    const normalized = String(reference || '').trim().toLowerCase();
    if (!normalized) return false;
    return this.isBundleSearchReference(normalized)
      || this.isSummaryOperationReference(normalized)
      || this.isSubjectSearchReference(normalized);
  }

  private isBundleSearchReference(reference: string): boolean {
    return reference.includes('/bundle/_search?') || reference.startsWith('bundle/_search?') || reference.startsWith('bundle?');
  }

  private isSummaryOperationReference(reference: string): boolean {
    return reference.includes('/subject/$summary')
      || reference.includes('/patient/$summary')
      || reference.includes('/researchsubject/$summary')
      || reference.startsWith('subject/$summary')
      || reference.startsWith('patient/$summary')
      || reference.startsWith('researchsubject/$summary');
  }

  private isSubjectSearchReference(reference: string): boolean {
    return reference.includes('/subject/_search')
      || reference.startsWith('subject/_search')
      || reference.includes('/patient/_search')
      || reference.startsWith('patient/_search');
  }

  private parseEmbeddedSearchReference(
    reference: string,
    fallbackJob: JobRequest,
    entry: any,
    fhirResource: FhirCommunication,
  ): { section: string; format: string; resourceType: string; action: string; body: Record<string, unknown> } | undefined {
    const normalized = String(reference || '').trim();
    if (!normalized) return undefined;

    let pathname = normalized;
    let search = '';
    if (/^https?:\/\//i.test(normalized)) {
      const parsed = new URL(normalized);
      pathname = parsed.pathname;
      search = parsed.search || '';
    } else {
      const syntheticUrl = new URL(normalized.startsWith('/') ? normalized : `/${normalized}`, 'http://internal.local');
      pathname = syntheticUrl.pathname;
      search = syntheticUrl.search || '';
    }

    const cleanPath = pathname.replace(/^\/+/, '');
    const segments = cleanPath.split('/').filter(Boolean);
    if (segments.length < 2) return undefined;

    let section = String(fallbackJob.section || '').trim() || SUBJECT_SECTION_INDIVIDUAL;
    let format = String(fallbackJob.format || '').trim();

    const directIndex = segments.findIndex((segment) => segment === SUBJECT_SECTION_INDIVIDUAL || segment === 'digitaltwin');
    if (directIndex >= 0 && segments.length >= directIndex + 4) {
      section = segments[directIndex];
      format = segments[directIndex + 1];
    } else if (segments.length >= 4) {
      section = segments[0];
      format = segments[1];
    }

    const query = search.startsWith('?') ? search.slice(1) : search;
    const normalizedPath = cleanPath.toLowerCase();
    if (this.isSummaryOperationReference(normalizedPath)) {
      const summaryResourceType = normalizedPath.includes('researchsubject/$summary')
        ? 'ResearchSubject'
        : 'Subject';
      return {
        section,
        format,
        resourceType: summaryResourceType,
        action: '$summary',
        body: this.buildSummaryParametersBody(query, entry, fhirResource),
      };
    }

    if (this.isSubjectSearchReference(normalizedPath)) {
      return {
        section,
        format,
        resourceType: 'Subject',
        action: '_search',
        body: this.buildSubjectSearchBody(query, entry, fhirResource),
      };
    }

    const requestUrl = `Bundle${query ? `?${query}` : ''}`;
    return {
      section,
      format,
      resourceType: ResourceTypesFhirR4.Bundle,
      action: '_search',
      body: {
        resourceType: ResourceTypesFhirR4.Bundle,
        type: 'batch',
        entry: [
          {
            request: {
              method: HttpRequestMethods.Get,
              url: requestUrl,
            },
          },
        ],
      },
    };
  }

  /**
   * Resolves the FHIR `Parameters` body for an embedded `$summary` read.
   *
   * The canonical claims-first Communication stores both the operation
   * reference and serialized Parameters attachment in `resource.meta.claims`.
   * Native FHIR payloads remain a supported input projection, but manager
   * execution never requires claims to be converted into `payload[]`.
   *
   * Query-string conversion remains a compatibility path for older clients.
   */
  private buildSummaryParametersBody(
    query: string,
    entry: any,
    fhirResource: FhirCommunication,
  ): Record<string, unknown> {
    for (const resolved of this.resolveCommunicationAttachments(entry, fhirResource)) {
      const attachment = resolved.documentAttachment;
      const parsed = this.parseAttachmentJson(attachment);
      if (parsed?.resourceType === FHIR_PARAMETERS_RESOURCE_TYPE
        && Array.isArray(parsed.parameter)) {
        return parsed as Record<string, unknown>;
      }
    }

    const params = new URLSearchParams(query);
    const parameter: Array<Record<string, unknown>> = [];
    const parameterNameByQueryKey: Record<string, string> = {
      subject: 'subject',
      'composition.subject': 'subject',
      'document-type': 'document-type',
      'composition.type': 'document-type',
      section: 'section',
      'composition.section': 'section',
      'section:not': 'exclude-section',
      'composition.section:not': 'exclude-section',
      'exclude-section': 'exclude-section',
      'exclude-sections': 'exclude-section',
    };

    for (const [key, rawValue] of params.entries()) {
      const parameterName = parameterNameByQueryKey[String(key || '').trim().toLowerCase()];
      const value = String(rawValue || '').trim();
      if (!parameterName || !value) continue;
      parameter.push({
        name: parameterName,
        valueString: value,
      });
    }

    return {
      resourceType: ResourceTypesFhirR4.Parameters,
      parameter,
    };
  }

  private buildSubjectSearchBody(
    query: string,
    entry: any,
    fhirResource: FhirCommunication,
  ): Record<string, unknown> {
    for (const resolved of this.resolveCommunicationAttachments(entry, fhirResource)) {
      const parsed = this.parseAttachmentJson(resolved.documentAttachment);
      if (parsed?.resourceType === FHIR_PARAMETERS_RESOURCE_TYPE) {
        return parsed as Record<string, unknown>;
      }
    }

    const params = new URLSearchParams(query);
    const parameter: Array<Record<string, unknown>> = [];
    for (const [key, rawValue] of params.entries()) {
      const name = String(key || '').trim().toLowerCase();
      const value = String(rawValue || '').trim();
      if (!value) continue;
      parameter.push({
        name,
        valueString: value,
      });
    }

    return {
      resourceType: ResourceTypesFhirR4.Parameters,
      parameter,
    };
  }

  private async persistCompositionProjectionFromCommunication(
    job: JobRequest,
    entry: any,
    fhirResource: FhirCommunication,
    serverDid: string,
  ): Promise<void> {
    const tenantVaultId = getTenantVaultId(job.sector as string, job.tenantId as string);
    const tenantExists = await this.tenantsCacheManager.tenantExists(tenantVaultId);
    if (!tenantExists) return;

    const rawSubject =
      (entry?.resource?.meta?.claims?.[CommunicationClaim.Subject] as string | undefined)
      || (fhirResource?.subject as any)?.reference
      || '';
    const subject = String(rawSubject || '').replace(/^Patient\//i, '').trim();
    if (!subject) return;

    const claimsSection = String(
      (entry?.resource?.meta?.claims?.[CommunicationClaim.Topic] as string | undefined)
      || (entry?.resource?.meta?.claims?.[CompositionClaim.Section] as string | undefined)
      || '',
    ).trim();
    const claimsType = String(
      (entry?.resource?.meta?.claims?.[CompositionClaim.Type] as string | undefined)
      || '',
    ).trim();
    const payloadComposition = this.extractCompositionResourceFromCommunication(entry, fhirResource);
    const attachmentClaims = this.resolveCommunicationAttachments(entry, fhirResource)
      .map((resolved) => this.parseAttachmentJson(resolved.documentAttachment))
      .map((attachment) => attachment?.meta?.claims && typeof attachment.meta.claims === 'object'
        ? normalizeContextualizedClaims(attachment.meta.claims as Record<string, any>)
        : undefined)
      .find(Boolean);
    const commandClaims = normalizeContextualizedClaims({
      ...(entry?.resource?.meta?.claims && typeof entry.resource.meta.claims === 'object'
        ? entry.resource.meta.claims : {}),
    });
    const embeddedClaims = normalizeContextualizedClaims({
      ...commandClaims,
      ...(attachmentClaims || {}),
      ...(payloadComposition?.meta?.claims && typeof payloadComposition.meta.claims === 'object'
        ? payloadComposition.meta.claims : {}),
      ...(payloadComposition ? compositionFhirR4ToFlat(payloadComposition as any) : {}),
      ...(payloadComposition?.status ? { 'Composition.status': payloadComposition.status } : {}),
    });
    const payloadSections = this.extractCompositionSectionsFromCommunication(entry, fhirResource);
    const payloadSection = payloadSections[0];
    const payloadType = this.extractCompositionTypeFromCommunication(entry, fhirResource);
    const sectionCodes = Array.from(new Set([
      ...claimsSection.split(','),
      ...payloadSections,
      payloadSection,
    ].map((value) => String(value || '').trim()).filter(Boolean)));
    if (sectionCodes.length === 0) return;
    const typeCode = claimsType || payloadType || HealthcareBasicSections.PatientSummaryDocument.attributeValue;

    const sent = String(
      (entry?.resource?.meta?.claims?.[CommunicationClaim.Sent] as string | undefined)
      || fhirResource?.sent
      || new Date().toISOString(),
    );

    const compositionIdentifier =
      this.normalizeOptionalString(payloadComposition?.identifier?.[0]?.value)
      || this.getFirstClaimValue(embeddedClaims || {}, ['Composition.identifier', 'Composition.identifier.value'])
      || this.normalizeOptionalString(payloadComposition?.id)
      || `urn:uuid:${uuidv4()}`;
    const fallbackId =
      this.normalizeOptionalString(payloadComposition?.id)
      || determineResourceId(compositionIdentifier, process.env.NODE_ENV);

    const sectionValue = sectionCodes.join(',');
    const claims = canonicalizeFhirClaims({
      ...(embeddedClaims || {}),
      '@context': Format.FHIR_API,
      'Composition.identifier': compositionIdentifier,
      [CompositionClaim.Subject]: subject,
      [CompositionClaim.Section]: sectionValue,
      [CompositionClaim.Author]: this.resolveClinicalResourceAuthor(job, entry, fhirResource) || serverDid,
      'Composition.date': sent,
      [CompositionClaim.Type]: typeCode,
      'Composition.source': 'Communication',
    }, Format.FHIR_API);
    // A native document import preserves the source Composition author graph.
    // The authenticated importer is transport/audit provenance and must not
    // be required to own the external document author or attester identities.
    // Direct section commands still require the enrolled creator binding.
    if (claimsSection && !payloadComposition) {
      try {
        await this.requireAuthenticatedSectionProvenance(job, tenantVaultId, claims);
      } catch (error) {
        if (error instanceof ManagerError && error.status === String(HttpStatusCodes.Forbidden)) {
          return undefined;
        }
        throw error;
      }
    }
    applyFhirCidVersioningToEntry({
      entry: payloadComposition ? { resource: payloadComposition } : { resource: { resourceType: ResourceTypesFhirR4.Composition, id: fallbackId } },
      claims,
      resourceType: ResourceTypesFhirR4.Composition,
      resourceId: fallbackId,
    });
    const contentVersionId = claimsToContentCid(claims).cid;
    claims['Composition.meta.versionId'] = contentVersionId;

    const individualSectionId = getSubjectScopedSectionId(subject, SUBJECT_SECTION_INDIVIDUAL, 'composition');
    const versionId = this.normalizeOptionalString(
      claims['Composition.meta.versionId']
      || claims['org.hl7.fhir.r4.Composition.meta.versionId'],
    );
    if (versionId) {
      const exists = await this.hasSectionRecordWithClaims(tenantVaultId, individualSectionId, [
        { name: 'Composition.meta.versionId', value: versionId },
      ]);
      if (exists) return;
    }
    const recordId = this.buildStableProjectionRecordId('composition-from-communication', compositionIdentifier);
    const record = { id: recordId, ...claims } as any;
    await this.vaultRepository.put(tenantVaultId, [record], individualSectionId);
    if (!isFinalizedDigitalTwinResearchRecord(ResourceTypesFhirR4.Composition, claims)) return;
    if (!isProfessionallyAttestedResearchRecord(claims)) return;
    if (!await isDigitalTwinSecondaryUseEnabled({
      vaultRepository: this.vaultRepository,
      tenantVaultId,
      sourceSubject: subject,
    })) return;
    const twinSubjectId = await getOrCreateDigitalTwinSubjectId({
      vaultRepository: this.vaultRepository,
      tenantVaultId,
      sourceSubject: subject,
    });
    const { claims: researchClaims } = await resolveAndProjectClaimsForDigitalTwin({
      claims,
      resourceType: ResourceTypesFhirR4.Composition,
      twinSubjectId,
      sector: String(job.sector || ''),
      jurisdiction: String(job.jurisdiction || ''),
    });
    const researchVersionId = claimsToContentCid(researchClaims).cid;
    researchClaims['Composition.meta.versionId'] = researchVersionId;
    researchClaims['org.hl7.fhir.r4.Composition.meta.versionId'] = researchVersionId;
    const researchRecordId = this.buildStableProjectionRecordId(
      'digital-twin-composition',
      String(researchClaims['Composition.identifier'] || researchClaims['org.hl7.fhir.r4.Composition.identifier'] || researchVersionId),
    );
    const digitalTwinSectionId = getSubjectScopedSectionId(twinSubjectId, SUBJECT_SECTION_DIGITAL_TWIN, 'composition');
    await this.vaultRepository.put(tenantVaultId, [{ id: researchRecordId, ...researchClaims } as any], digitalTwinSectionId);
  }

  private async persistCommunicationChannelRecord(
    job: JobRequest,
    entry: any,
    fhirResource: FhirCommunication,
    commMsg: CommMsgExtended,
  ): Promise<void> {
    const tenantVaultId = getTenantVaultId(job.sector as string, job.tenantId as string);
    const tenantExists = await this.tenantsCacheManager.tenantExists(tenantVaultId);
    if (!tenantExists) return;

    const subject = this.resolveCommunicationSubject(entry, fhirResource);
    const recipient = this.resolveCommunicationRecipient(entry, fhirResource);
    const sender = this.resolveCommunicationSender(entry, fhirResource);
    const channelActor = subject
      || recipient?.split(',').map((value) => value.trim()).find(Boolean)
      || commMsg.to?.map((value) => String(value || '').trim()).find(Boolean)
      || sender
      || this.normalizeOptionalString(commMsg.from);
    if (!channelActor) return;

    const messageId =
      this.resolveCommunicationIdentifier(entry, fhirResource)
      || this.normalizeOptionalString(commMsg.id)
      || this.normalizeOptionalString((job.content as any)?.jti);
    if (!messageId) return;
    const sent =
      this.resolveCommunicationSent(entry, fhirResource)
      || (commMsg.created_time ? new Date(commMsg.created_time * 1000).toISOString() : undefined)
      || new Date().toISOString();

    const suppliedClaims = entry?.resource?.meta?.claims as Record<string, unknown> | undefined;
    const rawClaims = String(job.format || '').trim() !== Format.FHIR_API
      ? { ...this.projectNativeCommunicationStorageClaims(entry, fhirResource), ...(suppliedClaims || {}) }
      : suppliedClaims;
    if (String(job.format || '').trim() === Format.FHIR_API) {
      const claimsOnlyResource = {
        resourceType: COMMUNICATION_RESOURCE_TYPE,
        id: messageId,
        meta: { claims: suppliedClaims },
      };
      requireClaimsOnlyResourceShape(claimsOnlyResource, COMMUNICATION_RESOURCE_TYPE, 'Communication');
    }
    const claims = this.normalizeCommunicationStorageClaims(rawClaims);
    const plaintextAttributes = [
      ...buildCommunicationParticipantIndexAttributes({
        subject: claims[CommunicationClaim.Subject],
        sender: claims[CommunicationClaim.Sender],
        recipients: claims[CommunicationClaim.Recipient],
      }),
      ...this.communicationScalarIndexAttributes(claims, CommunicationClaim.Category),
      ...this.communicationScalarIndexAttributes(claims, CommunicationClaim.Topic),
    ];
    const protectedAttributes = await this.kmsService.protectAttributesNameAndValue(
      plaintextAttributes as any,
      tenantVaultId,
    );
    const sectionId = getSubjectScopedSectionId(channelActor, SUBJECT_SECTION_INDIVIDUAL, COMMUNICATION_SECTION_NAME);
    const currentCandidate = await this.vaultRepository.get<ConfidentialStorageDoc>(tenantVaultId, messageId, sectionId);
    const current = String(currentCandidate?.contentType || (currentCandidate as any)?.type || '').trim() === COMMUNICATION_ENTRY_TYPE
      ? currentCandidate
      : undefined;
    if (current) {
      const currentContent = await this.kmsService.unprotectConfidentialData<unknown>(current, tenantVaultId);
      this.readCommunicationStorageClaims(currentContent);
    }
    const document: ConfidentialStorageDoc = {
      id: messageId,
      status: EntityLifecycleStatus.Active,
      sequence: Number(current?.sequence ?? -1) + 1,
      contentType: COMMUNICATION_ENTRY_TYPE,
      content: { claims },
      indexed: { attributes: protectedAttributes },
      audit: {
        created: sent,
        updated: sent,
        channel: 'communication',
      },
    };
    const protectedDocument = await this.kmsService.protectConfidentialData(document, tenantVaultId);
    await this.vaultRepository.put(tenantVaultId, [protectedDocument], sectionId);
  }

  private extractCompositionSectionsFromCommunication(
    entry: any,
    fhirResource: FhirCommunication,
  ): string[] {
    const topicCoding = (fhirResource as any)?.topic?.coding?.[0];
    if (topicCoding?.system && topicCoding?.code) {
      return [this.toCanonicalCodingToken(topicCoding.system, topicCoding.code)];
    }

    const payload = Array.isArray((fhirResource as any)?.payload) ? (fhirResource as any).payload[0] : undefined;
    const fromCodeableConcept = payload?.contentCodeableConcept?.coding?.[0];
    if (fromCodeableConcept?.system && fromCodeableConcept?.code) {
      return [this.toCanonicalCodingToken(fromCodeableConcept.system, fromCodeableConcept.code)];
    }

    for (const resolvedAttachment of this.resolveCommunicationAttachments(entry, fhirResource)) {
      try {
        const parsed = this.asDocumentBundle(
          this.parseAttachmentJson(resolvedAttachment.documentAttachment),
        );
        if (!parsed) continue;
        const compositionEntry = parsed.entry.find((e: any) => e?.resource?.resourceType === 'Composition');
        const sectionCodes = Array.isArray(compositionEntry?.resource?.section)
          ? compositionEntry.resource.section
            .map((section: any) => {
              const sectionCoding = section?.code?.coding?.[0];
              return sectionCoding?.system && sectionCoding?.code
                ? this.toCanonicalCodingToken(sectionCoding.system, sectionCoding.code)
                : '';
            })
            .filter(Boolean)
          : [];
        if (sectionCodes.length > 0) return sectionCodes;
      } catch {
        continue;
      }
    }
    return [];
  }

  private extractCompositionTypeFromCommunication(
    entry: any,
    fhirResource: FhirCommunication,
  ): string | undefined {
    for (const resolvedAttachment of this.resolveCommunicationAttachments(entry, fhirResource)) {
      try {
        const parsed = this.asDocumentBundle(
          this.parseAttachmentJson(resolvedAttachment.documentAttachment),
        );
        if (!parsed) continue;
        const compositionEntry = parsed.entry.find((e: any) => e?.resource?.resourceType === 'Composition');
        const coding = compositionEntry?.resource?.type?.coding?.[0];
        if (coding?.system && coding?.code) {
          return this.toCanonicalCodingToken(coding.system, coding.code);
        }
      } catch {
        continue;
      }
    }
    return undefined;
  }

  private toCanonicalCodingToken(system: string, code: string): string {
    const normalizedSystem = String(system || '').trim();
    const normalizedCode = String(code || '').trim();
    if (!normalizedSystem || !normalizedCode) return '';
    if (normalizedSystem === 'http://loinc.org') {
      return `LOINC|${normalizedCode}`;
    }
    return `${normalizedSystem}|${normalizedCode}`;
  }

  private async persistDocumentReferenceProjectionFromCommunication(
    job: JobRequest,
    entry: any,
    fhirResource: FhirCommunication,
  ): Promise<void> {
    const tenantVaultId = getTenantVaultId(job.sector as string, job.tenantId as string);
    const tenantExists = await this.tenantsCacheManager.tenantExists(tenantVaultId);
    if (!tenantExists) return;

    const nowIso = new Date().toISOString();
    const subject = this.resolveCommunicationSubject(entry, fhirResource);
    if (!subject) return;
    const communicationSent = this.resolveCommunicationSent(entry, fhirResource) || nowIso;

    for (const resolvedAttachment of this.resolveCommunicationAttachments(entry, fhirResource)) {
      const attachment = resolvedAttachment?.documentAttachment;
      if (!attachment) continue;

      const contentType = String(attachment.contentType || 'application/octet-stream').trim();
      const dataBase64 = typeof attachment.data === 'string' ? attachment.data.trim() : '';
      const url = typeof attachment.url === 'string' ? attachment.url.trim() : '';
      if (!dataBase64 && !url) continue;

      const cid = this.deriveAttachmentCid({
        attachmentId: typeof attachment.id === 'string' ? attachment.id : undefined,
        contentType,
        dataBase64: dataBase64 || undefined,
        url: url || undefined,
      });
      if (!cid) continue;

      const documentReference = resolvedAttachment.documentReference;
      const embeddedClaims = documentReference?.meta?.claims && typeof documentReference.meta.claims === 'object'
        ? normalizeContextualizedClaims(documentReference.meta.claims as Record<string, any>)
        : undefined;
      const documentIdentifier =
        this.normalizeOptionalString(documentReference?.identifier?.[0]?.value)
        || this.getFirstClaimValue(embeddedClaims || {}, ['DocumentReference.identifier', 'DocumentReference.identifier.value'])
        || `urn:uuid:${uuidv4()}`;
      const claims = canonicalizeFhirClaims({
        ...(embeddedClaims || {}),
        '@context': Format.FHIR_API,
        'DocumentReference.identifier': documentIdentifier,
        'DocumentReference.contenthash': cid,
        'DocumentReference.subject': this.normalizeOptionalString(documentReference?.subject?.reference)?.replace(/^Patient\//i, '').trim() || subject,
        'DocumentReference.contenttype': contentType,
        'DocumentReference.date': this.normalizeOptionalString(documentReference?.date) || String(communicationSent),
      }, Format.FHIR_API);
      if (url) (claims as Record<string, string>)['DocumentReference.location'] = url;
      const description =
        this.normalizeOptionalString(documentReference?.description)
        || this.normalizeOptionalString(attachment.title)
        || this.getFirstClaimValue(claims, ['DocumentReference.description']);
      if (description) {
        (claims as Record<string, string>)['DocumentReference.description'] = description;
      }

      const sectionId = getSubjectScopedSectionId(subject, SUBJECT_SECTION_INDIVIDUAL, 'document-references');
      const alreadyIndexed = await this.hasSectionRecordWithClaims(tenantVaultId, sectionId, [
        { name: 'DocumentReference.contenthash', value: cid },
      ]);
      if (alreadyIndexed) continue;
      const recordId = this.buildStableProjectionRecordId('documentreference-from-communication', cid);
      await this.vaultRepository.put(tenantVaultId, [{ id: recordId, ...claims } as any], sectionId);
    }
  }

  private deriveAttachmentCid(params: {
    attachmentId?: string;
    contentType?: string;
    dataBase64?: string;
    url?: string;
  }): string | undefined {
    const attachmentId = String(params.attachmentId || '').trim();
    if (attachmentId.startsWith('z') && attachmentId.length > 10) return attachmentId;

    const contentType = String(params.contentType || '').toLowerCase();
    const dataBase64 = String(params.dataBase64 || '').trim();
    if (contentType.includes('fhir') && dataBase64) {
      try {
        const parsed = JSON.parse(Buffer.from(dataBase64, 'base64').toString('utf8'));
        if (parsed && typeof parsed === 'object') {
          return fhirResourceToCid(parsed as Record<string, unknown>).cid;
        }
      } catch {
      }
    }

    if (dataBase64) {
      try {
        const bytes = Buffer.from(dataBase64, 'base64');
        return this.rawBytesToCid(bytes);
      } catch {
        return undefined;
      }
    }

    const url = String(params.url || '').trim();
    if (url) return this.rawBytesToCid(Buffer.from(url, 'utf8'));
    return undefined;
  }

  private rawBytesToCid(input: Uint8Array): string {
    const digest = createHash('sha256').update(input).digest();
    const multihash = Buffer.concat([Buffer.from([0x12, 0x20]), digest]);
    const cidBytes = Buffer.concat([
      Buffer.from([0x01]),
      Buffer.from([0x55]),
      multihash,
    ]);
    return encodeMultibase58btc(new Uint8Array(cidBytes));
  }

  private buildStableProjectionRecordId(prefix: string, identity: string): string {
    const digest = createHash('sha256').update(String(identity || ''), 'utf8').digest('hex');
    return `${prefix}-${digest}`;
  }

  private async hasSectionRecordWithClaims(
    tenantVaultId: string,
    sectionId: string,
    where: Array<{ name: string; value: string }>,
  ): Promise<boolean> {
    if (!Array.isArray(where) || where.length === 0) return false;
    const matches = await this.vaultRepository.query(tenantVaultId, { sectionId, where }, { hydrate: false });
    return Array.isArray(matches) && matches.length > 0;
  }

  private async persistProjectedResourcesFromCommunication(
    job: JobRequest,
    entry: any,
    fhirResource: FhirCommunication,
  ): Promise<Array<BundleEntryResponse | ErrorEntry>> {
    const tenantVaultId = getTenantVaultId(job.sector as string, job.tenantId as string);
    const tenantExists = await this.tenantsCacheManager.tenantExists(tenantVaultId);
    if (!tenantExists) return [];

    const batchResponses: Array<BundleEntryResponse | ErrorEntry> = [];

    const communicationSubject = this.resolveCommunicationSubject(entry, fhirResource);
    const clinicalAuthorDid = this.resolveClinicalResourceAuthor(job, entry, fhirResource);
    await this.persistClinicalAuthorIdentityBinding(job, tenantVaultId, clinicalAuthorDid);
    const declaredSection = String(
      (entry?.resource?.meta?.claims?.[CommunicationClaim.Topic] as string | undefined)
      || (entry?.resource?.meta?.claims?.[CompositionClaim.Section] as string | undefined)
      || '',
    ).trim();
    const documentSections = this.extractCompositionSectionsFromCommunication(entry, fhirResource);
    // Implicit membership is unambiguous only for a one-section document.
    // Multi-section IPS resources must be linked by Composition.section[].entry[].
    const explicitSection = declaredSection
      || (documentSections.length === 1 ? documentSections[0] : '');
    for (const resolved of this.resolveCommunicationAttachments(entry, fhirResource)) {
      const attachment = resolved.documentAttachment;
      const parsedAttachment = this.parseAttachmentJson(attachment);
      const isSubsettedDocumentIndex = this.isSubsettedDocumentBundle(parsedAttachment);
      const documentProvenance = resolveClinicalDocumentAuthorOrganization(parsedAttachment);
      const compositionResource = this.asDocumentBundle(parsedAttachment)?.entry
        ?.map((bundleEntry: any) => bundleEntry?.resource)
        .find((resource: any) => resource?.resourceType === ResourceTypesFhirR4.Composition);
      const attachmentClaims = parsedAttachment?.meta?.claims
        && typeof parsedAttachment.meta.claims === 'object'
        ? normalizeContextualizedClaims(parsedAttachment.meta.claims as Record<string, any>)
        : undefined;
      const commandClaims = normalizeContextualizedClaims({
        ...(entry?.resource?.meta?.claims && typeof entry.resource.meta.claims === 'object'
          ? entry.resource.meta.claims : {}),
      });
      const documentClaims = compositionResource
        ? {
            ...commandClaims,
            ...(attachmentClaims || {}),
            ...compositionFhirR4ToFlat(compositionResource),
            ...(compositionResource.status ? { 'Composition.status': compositionResource.status } : {}),
          }
        : { ...commandClaims, ...(attachmentClaims || {}) };
      const attachedBundleType = String(parsedAttachment?.type || '').toLowerCase();
      if (
        parsedAttachment?.resourceType === ResourceTypesFhirR4.Bundle
        && attachedBundleType === 'batch'
      ) {
        const attachedEntries = Array.isArray(parsedAttachment.data)
          ? parsedAttachment.data
          : Array.isArray(parsedAttachment.entry) ? parsedAttachment.entry : [];
        // A permission request is an inbox message, not an authorization
        // command: its attachment is a Bundle of canonical FHIR Consent
        // resources whose status is `draft`. Keep the complete Bundle on the
        // Communication and never project those drafts into active rules.
        if (this.isDraftConsentRequestBatch(attachedEntries)) {
          continue;
        }
        const isRequestBatch = attachedEntries.length > 0
          && attachedEntries.every((attachedEntry: any) => attachedEntry?.request && typeof attachedEntry.request === 'object');
        if (isRequestBatch) {
          for (const attachedEntry of attachedEntries) {
            batchResponses.push(await this.processProjectedClinicalBatchEntry({
              job,
              entry: attachedEntry,
              creatorDid: clinicalAuthorDid,
              communicationSubject,
              explicitSection,
              fhirResource,
              tenantVaultId,
              documentClaims,
              documentStatusRequired: Boolean(compositionResource),
            }));
          }
          continue;
        }
      }
      const resources = this.extractProjectedFhirResourcesFromAttachment(
        attachment,
        Boolean(explicitSection),
      );
      for (const resource of resources) {
        const resourceType = this.getSupportedProjectedResourceType(resource?.resourceType);
        if (!resource || !resourceType) continue;

        await this.persistProjectedClinicalResource({
          job,
          resource,
          resourceType,
          communicationSubject,
          explicitSection,
          fhirResource,
          tenantVaultId,
          creatorDid: clinicalAuthorDid,
          documentImport: true,
          documentProvenance,
          documentClaims,
          documentStatusRequired: Boolean(compositionResource),
          isSubsettedDocumentIndex,
        });
      }
    }
    return batchResponses;
  }

  private async processProjectedClinicalBatchEntry(input: {
    job: JobRequest;
    entry: any;
    creatorDid?: string;
    communicationSubject?: string;
    explicitSection: string;
    fhirResource: FhirCommunication;
    tenantVaultId: string;
    documentClaims?: Record<string, unknown>;
    documentStatusRequired?: boolean;
  }): Promise<BundleEntryResponse | ErrorEntry> {
    const request = input.entry?.request;
    const resource = input.entry?.resource;
    const requestMethod = String(request?.method || '').trim().toUpperCase();
    const requestUrlParts = String(request?.url || '').trim().split('/').filter(Boolean);
    const rawResourceType = String(
      resource?.resourceType || (requestMethod === 'DELETE' ? requestUrlParts[0] : ''),
    ).trim();
    const resourceType = this.getSupportedProjectedResourceType(
      resource?.resourceType || (requestMethod === 'DELETE' ? requestUrlParts[0] : undefined),
    );
    const recordId = this.normalizeOptionalString(
      resource?.id || (requestMethod === 'DELETE' ? requestUrlParts[1] : undefined),
    );
    const responseType = this.normalizeOptionalString(input.entry?.type)
      || `${String(resource?.resourceType || 'Resource')}-response-v1.0`;

    const errorResponse = (status: string, text: string): ErrorEntry => ({
      id: recordId,
      type: responseType,
      ...canonicalizeBundleEntryMetadata(input.entry?.meta as Record<string, unknown> | undefined),
      response: {
        status,
        outcome: {
          resourceType: ResourceTypesFhirR4.OperationOutcome,
          issue: [{
            severity: 'error',
            code: status === '403' ? 'forbidden' : status === '412' ? 'conflict' : 'processing',
            diagnostics: text,
          }],
        },
      },
    });

    if (rawResourceType === 'Task') {
      if (!this.taskManager) return errorResponse('503', 'Task manager is not configured.');
      if (requestMethod !== 'POST' || this.normalizeOptionalString(request?.url) !== 'Task') {
        return errorResponse('400', 'Immunization reminder Task creation requires POST Task.');
      }
      if (!getAuthenticatedJobActorIdentifiers(input.job)[0]) {
        return errorResponse('403', 'Task creation requires one verified DIDComm issuer.');
      }
      try {
        const delegated = await this.taskManager.process({
          ...input.job,
          action: '_batch',
          content: {
            ...(input.job.content as IDecodedDidcommPayload),
            body: { resourceType: 'Bundle', type: 'batch', data: [input.entry] },
          } as IDecodedDidcommPayload,
        });
        const response = (delegated.body as any)?.data?.[0];
        return response || errorResponse('500', 'Task manager returned no reminder result.');
      } catch (error) {
        return errorResponse('400', error instanceof Error ? error.message : 'Task creation failed.');
      }
    }

    if (!resourceType || !request || typeof request !== 'object') {
      return errorResponse('400', 'Clinical batch entry requires one supported resource and request.');
    }
    const actorDid = getAuthenticatedJobActorIdentifiers(input.job)[0];
    if (!actorDid) {
      return errorResponse('403', 'Clinical batch entry requires one verified DIDComm issuer.');
    }

    if (requestMethod === 'POST') {
      if (this.normalizeOptionalString(request.url) !== resourceType) {
        return errorResponse('400', 'Clinical create request.url must equal resource.resourceType.');
      }
      try {
        const created = await this.persistProjectedClinicalResource({
          job: input.job,
          resource,
          resourceType,
          communicationSubject: input.communicationSubject,
          explicitSection: input.explicitSection,
          fhirResource: input.fhirResource,
          tenantVaultId: input.tenantVaultId,
          creatorDid: input.creatorDid || actorDid,
          documentClaims: input.documentClaims,
          documentStatusRequired: input.documentStatusRequired,
        });
        return {
          id: created.recordId,
          type: responseType,
          response: {
            status: created.created ? '201' : '200',
            etag: `W/"${created.versionId}"`,
            ...(created.terminologyWarning ? { outcome: created.terminologyWarning } : {}),
          },
          resource: { resourceType, id: created.recordId },
        };
      } catch (error) {
        const status = error instanceof ManagerError ? error.status : '400';
        return errorResponse(status, error instanceof Error ? error.message : 'Clinical create failed.');
      }
    }

    if (requestMethod === 'PUT') {
      if (!recordId || this.normalizeOptionalString(request.url) !== `${resourceType}/${recordId}`) {
        return errorResponse('400', 'Clinical update request.url must address resource.resourceType/resource.id.');
      }
      const subject = this.normalizeOptionalString(input.communicationSubject);
      if (!subject) return errorResponse('400', 'Clinical update requires Communication.subject.');
      const sectionId = getSubjectScopedSectionId(
        subject,
        SUBJECT_SECTION_INDIVIDUAL,
        PROJECTED_RESOURCE_CONFIG[resourceType].collectionId,
      );
      const existing = await this.vaultRepository.get<{ id: string; [key: string]: any }>(
        input.tenantVaultId,
        recordId,
        sectionId,
      );
      if (!existing) return errorResponse('404', 'Clinical record was not found for this subject.');
      const authors = [
        ...String(existing[CompositionClaim.Author] || existing?.audit?.creatorDid || '').split(','),
      ]
        .map((author) => String(author || '').trim())
        .filter(Boolean);
      const attesters = String(existing[CompositionClaim.Attester] || '')
        .split(',').map((value) => value.trim()).filter(Boolean);
      if (!await this.isAuthenticatedClinicalAttesterOrSameOwner(
        input.job,
        input.tenantVaultId,
        attesters,
        authors,
      )) {
        return errorResponse('403', 'Only the authenticated creator may update this clinical record.');
      }
      const storedSubject = this.resolveProjectedResourceSubject(
        existing,
        PROJECTED_RESOURCE_CONFIG[resourceType].subjectClaimKeys,
      );
      if (storedSubject !== subject) {
        return errorResponse('403', 'Clinical record does not belong to Communication.subject.');
      }
      const expectedVersion = this.parseIfMatchVersion(request.ifMatch);
      if (request.ifMatch !== undefined) {
        if (!expectedVersion) {
          return errorResponse('400', 'Clinical update request.ifMatch must contain a weak ETag version.');
        }
        const currentVersion = this.getFirstClaimValue(existing, [
          `${resourceType}.meta.versionId`,
          `org.hl7.fhir.r4.${resourceType}.meta.versionId`,
        ]);
        if (!currentVersion || currentVersion !== expectedVersion) {
          return errorResponse('412', 'Clinical record version does not match request.ifMatch.');
        }
      }
      try {
        const updated = await this.persistProjectedClinicalResource({
          job: input.job,
          resource,
          resourceType,
          communicationSubject: input.communicationSubject,
          explicitSection: input.explicitSection,
          fhirResource: input.fhirResource,
          tenantVaultId: input.tenantVaultId,
          creatorDid: input.creatorDid || authors[0],
          documentClaims: input.documentClaims || existing,
          documentStatusRequired: input.documentStatusRequired,
        });
        return {
          id: updated.recordId,
          type: responseType,
          response: {
            status: '200',
            etag: `W/"${updated.versionId}"`,
            ...(updated.terminologyWarning ? { outcome: updated.terminologyWarning } : {}),
          },
          resource: { resourceType, id: updated.recordId },
        };
      } catch (error) {
        const status = error instanceof ManagerError ? error.status : '400';
        return errorResponse(status, error instanceof Error ? error.message : 'Clinical update failed.');
      }
    }

    if (requestMethod === 'DELETE') {
      if (!recordId || this.normalizeOptionalString(request.url) !== `${resourceType}/${recordId}`) {
        return errorResponse('400', 'Clinical delete request.url must address resource.resourceType/resource.id.');
      }
      const subject = this.normalizeOptionalString(input.communicationSubject);
      if (!subject) {
        return errorResponse('400', 'Clinical delete requires Communication.subject.');
      }
      const sectionId = getSubjectScopedSectionId(
        subject,
        SUBJECT_SECTION_INDIVIDUAL,
        PROJECTED_RESOURCE_CONFIG[resourceType].collectionId,
      );
      const existing = await this.vaultRepository.get<{ id: string; [key: string]: any }>(
        input.tenantVaultId,
        recordId,
        sectionId,
      );
      if (!existing) {
        return errorResponse('404', 'Clinical record was not found for this subject.');
      }
      const authors = [
        ...String(existing[CompositionClaim.Author] || existing?.audit?.creatorDid || '').split(','),
      ]
        .map((author) => String(author || '').trim())
        .filter(Boolean);
      const attesters = String(existing[CompositionClaim.Attester] || '')
        .split(',').map((value) => value.trim()).filter(Boolean);
      if (!await this.isAuthenticatedClinicalAttester(
        input.job,
        input.tenantVaultId,
        attesters,
        authors,
      )) {
        return errorResponse('403', 'Only the authenticated creator may delete this clinical record.');
      }
      const storedSubject = this.resolveProjectedResourceSubject(
        existing,
        PROJECTED_RESOURCE_CONFIG[resourceType].subjectClaimKeys,
      );
      if (storedSubject !== subject) {
        return errorResponse('403', 'Clinical record does not belong to Communication.subject.');
      }
      const expectedVersion = this.parseIfMatchVersion(request.ifMatch);
      if (request.ifMatch !== undefined) {
        if (!expectedVersion) {
          return errorResponse('400', 'Clinical delete request.ifMatch must contain a weak ETag version.');
        }
        const currentVersion = this.getFirstClaimValue(existing, [
          `${resourceType}.meta.versionId`,
          `org.hl7.fhir.r4.${resourceType}.meta.versionId`,
        ]);
        if (!currentVersion || currentVersion !== expectedVersion) {
          return errorResponse('412', 'Clinical record version does not match request.ifMatch.');
        }
      }
      await this.vaultRepository.delete(input.tenantVaultId, recordId, sectionId);
      await this.deleteCorrelatedDigitalTwinProjection({
        tenantVaultId: input.tenantVaultId,
        sourceSubject: subject,
        resourceType,
        sourceRecordId: recordId,
      });
      return {
        id: recordId,
        type: responseType,
        response: { status: String(HttpStatusCodes.NoContent) },
        resource: { resourceType, id: recordId },
      };
    }

    return errorResponse('400', `Unsupported clinical batch method: ${String(request.method || '')}`);
  }

  private async deleteCorrelatedDigitalTwinProjection(input: {
    tenantVaultId: string;
    sourceSubject: string;
    resourceType: SupportedProjectedResourceType;
    sourceRecordId: string;
  }): Promise<void> {
    if (!isDigitalTwinResearchResourceType(input.resourceType)) return;
    const enabled = await isDigitalTwinSecondaryUseEnabled({
      vaultRepository: this.vaultRepository,
      tenantVaultId: input.tenantVaultId,
      sourceSubject: input.sourceSubject,
    });
    if (!enabled) return;
    const twinSubjectId = await getOrCreateDigitalTwinSubjectId({
      vaultRepository: this.vaultRepository,
      tenantVaultId: input.tenantVaultId,
      sourceSubject: input.sourceSubject,
    });
    const sectionId = getSubjectScopedSectionId(
      twinSubjectId,
      SUBJECT_SECTION_DIGITAL_TWIN,
      PROJECTED_RESOURCE_CONFIG[input.resourceType].collectionId,
    );
    const projections = await this.vaultRepository.listContainersInSection<any>(input.tenantVaultId, sectionId);
    for (const projection of projections) {
      if (this.normalizeOptionalString(projection?.audit?.sourceRecordId) !== input.sourceRecordId) continue;
      await this.vaultRepository.delete(input.tenantVaultId, String(projection.id), sectionId);
    }
  }

  private parseIfMatchVersion(value: unknown): string | undefined {
    const normalized = this.normalizeOptionalString(value);
    const match = normalized?.match(/^W\/"([^"]+)"$/);
    return match?.[1];
  }

  private async persistProjectedClinicalResource(input: {
    job: JobRequest;
    resource: Record<string, any>;
    resourceType: SupportedProjectedResourceType;
    communicationSubject?: string;
    explicitSection: string;
    fhirResource: FhirCommunication;
    tenantVaultId: string;
    creatorDid?: string;
    documentImport?: boolean;
    documentProvenance?: ClinicalDocumentAuthorOrganization;
    documentClaims?: Record<string, unknown>;
    documentStatusRequired?: boolean;
    isSubsettedDocumentIndex?: boolean;
  }): Promise<{ recordId: string; versionId: string; created: boolean; terminologyWarning?: OperationOutcome }> {
    // A source-authored URN is import provenance, not the importing BFF's
    // identity. It may be persisted once; the existing-record authorization
    // below deliberately prevents that local actor from replacing it.
    const config = PROJECTED_RESOURCE_CONFIG[input.resourceType];
    const isMinimalIndexProjection = this.isMinimalDocumentIndexResource(
      input.resource,
      input.isSubsettedDocumentIndex === true,
    );
    const projectedResource = isMinimalIndexProjection
      ? {
          resourceType: input.resource.resourceType,
          id: input.resource.id,
          meta: { tag: input.resource.meta.tag },
        }
      : input.resource;
    const authenticatedActorDid = getAuthenticatedJobActorIdentifiers(input.job)
      .find((identifier) => identifier.startsWith('did:web:'));
    const isExternalAuthorUrn = Boolean(input.creatorDid?.startsWith('urn:'));
    const isDocumentGraphAuthor = Boolean(
      input.documentProvenance
      && input.creatorDid === input.documentProvenance.authorReference
      && (
        input.creatorDid === input.documentProvenance.organizationReference
        || await this.isRegisteredClinicalAuthor(input.tenantVaultId, input.creatorDid)
      ),
    );
    const isRegisteredDelegatedAuthor = Boolean(
      input.creatorDid
      && authenticatedActorDid
      && input.creatorDid !== authenticatedActorDid
      && await this.isRegisteredClinicalAuthor(input.tenantVaultId, input.creatorDid),
    );
    if (!input.creatorDid || (
      !isExternalAuthorUrn
      && !isDocumentGraphAuthor
      && input.creatorDid !== authenticatedActorDid
      && !isRegisteredDelegatedAuthor
    )) {
      throw new ManagerError(
        'Clinical Composition.author must identify the authenticated actor or a registered clinical author.',
        IssueType.Security,
      );
    }
    const claims = this.extractProjectedResourceClaims(
      input.resourceType,
      projectedResource,
      input.communicationSubject,
      input.fhirResource,
      input.creatorDid,
      input.documentClaims,
    );
    // A document import preserves the source Composition author graph. Its
    // authenticated importer is audited separately and must not be forced into
    // the author/attester slots used by a direct section edit.
    if (input.explicitSection && !input.documentImport) {
      await this.requireAuthenticatedSectionProvenance(input.job, input.tenantVaultId, claims);
    }
    if (input.explicitSection && !getClaimValue<string>(claims, CompositionClaim.Section)) {
      claims[CompositionClaim.Section] = input.explicitSection;
    }
    const subjectRef = this.resolveProjectedResourceSubject(claims, config.subjectClaimKeys);
    if (!subjectRef) {
      throw new Error('Clinical resource requires one subject.');
    }
    if (input.communicationSubject && subjectRef !== input.communicationSubject) {
      throw new Error('Clinical resource subject must equal Communication.subject.');
    }

    const identifier = this.getFirstClaimValue(claims, config.identifierClaimKeys) || `urn:uuid:${uuidv4()}`;
    const fallbackId = determineResourceId(identifier, process.env.NODE_ENV);
    const versionId = claimsToContentCid(this.clinicalContentVersionClaims(claims)).cid;
    applyFhirCidVersioningToEntry({
      entry: { resource: input.resource },
      claims,
      resourceType: input.resourceType,
      resourceId: fallbackId,
    });
    claims[`${input.resourceType}.meta.versionId`] = versionId;
    claims[`org.hl7.fhir.r4.${input.resourceType}.meta.versionId`] = versionId;
    const sectionId = getSubjectScopedSectionId(
      subjectRef,
      SUBJECT_SECTION_INDIVIDUAL,
      config.collectionId,
    );
    const recordId = String(input.resource?.id || versionId || fallbackId);
    const parentDocumentStatus = this.getFirstClaimValue(input.documentClaims || {}, ['Composition.status']);
    const parentDocumentFinalized = (
      !(input.documentStatusRequired || parentDocumentStatus)
      || isFinalizedDigitalTwinResearchRecord(
        ResourceTypesFhirR4.Composition,
        input.documentClaims || {},
      )
    );
    const incomingResearchFinalized = (
      parentDocumentFinalized
      && isFinalizedDigitalTwinResearchRecord(input.resourceType, claims)
    );
    const existing = await this.vaultRepository.get<{ id: string } & Record<string, any>>(
      input.tenantVaultId,
      recordId,
      sectionId,
    );
    const alreadyIndexed = await this.hasSectionRecordWithClaims(input.tenantVaultId, sectionId, [
      { name: `${input.resourceType}.meta.versionId`, value: versionId },
    ]);
    if (alreadyIndexed && (
      !incomingResearchFinalized
      || !isDigitalTwinResearchResourceType(input.resourceType)
    )) {
      return { recordId, versionId, created: false };
    }
    if (existing?.id === recordId) {
      const existingAuthors = [
        ...String(existing[CompositionClaim.Author] || existing?.audit?.creatorDid || '').split(','),
      ]
        .map((author) => String(author || '').trim())
        .filter(Boolean);
      const existingAttesters = String(existing[CompositionClaim.Attester] || '')
        .split(',').map((value) => value.trim()).filter(Boolean);
      const isExactAuthor = await this.isAuthenticatedClinicalAttesterOrSameOwner(
        input.job,
        input.tenantVaultId,
        existingAttesters,
        existingAuthors,
      );
      const replacementDecision = input.documentProvenance
        ? evaluateClinicalResourceReplacement({
          existing: {
            resourceId: recordId,
            authorOwnerIdentifier: String(existing?.audit?.authorOwnerIdentifier || ''),
            documentDate: String(existing?.audit?.documentDate || ''),
          },
          incoming: {
            resourceId: recordId,
            authorOwnerIdentifier: input.documentProvenance.organizationReference,
            documentDate: input.documentProvenance.documentDate,
          },
        })
        : ClinicalResourceReplacementDecision.Deny;
      const replacesImportedDocument = Boolean(
        input.documentProvenance && existing?.audit?.authorOwnerIdentifier,
      );
      if (
        (replacesImportedDocument
          && replacementDecision !== ClinicalResourceReplacementDecision.AllowOrganizationSuccessor)
        || (!replacesImportedDocument
          && !isExactAuthor
          && replacementDecision !== ClinicalResourceReplacementDecision.AllowOrganizationSuccessor)
      ) {
        throw new ManagerError(
          'Only the authenticated author may update this clinical resource.',
          IssueType.Security,
        );
      }
    }

    const persistedClaims = isMinimalIndexProjection && existing
      ? {
          ...Object.fromEntries(Object.entries(existing).filter(([name]) =>
            !['id', 'audit', 'indexed', 'status', 'sequence', 'contentType', 'content'].includes(name))),
          ...claims,
        }
      : claims;
    const isResearchFinalized = (
      parentDocumentFinalized
      && isFinalizedDigitalTwinResearchRecord(input.resourceType, persistedClaims)
    );

    const consentStatus = this.getFirstClaimValue(persistedClaims, [ClaimConsent.status]);
    const isConsentRule = input.resourceType === 'Consent'
      && consentStatus === ConsentStatuses.Active
      && Boolean(this.getFirstClaimValue(persistedClaims, [ClaimConsent.decision]));
    if (isConsentRule) {
      const persistedConsent = await persistConsentRuleAndAttachment({
        vaultRepository: this.vaultRepository,
        blockchainAdapter: this.blockchainAdapter,
        tenantVaultId: input.tenantVaultId,
        sector: String(input.job.sector || ''),
        jurisdiction: String(input.job.jurisdiction || ''),
        claims: persistedClaims,
      });
      return {
        recordId,
        versionId,
        created: true,
        ...(persistedConsent.warnings?.[0] ? { terminologyWarning: persistedConsent.warnings[0] } : {}),
      };
    }

    const signingKeyId = clinicalCreatorEvidence(input.job).keyId;
    const audit = input.creatorDid ? {
      creatorDid: authenticatedActorDid || input.creatorDid,
      ...(input.documentProvenance ? {
        authorOwnerIdentifier: input.documentProvenance.organizationReference,
        documentDate: input.documentProvenance.documentDate,
      } : {}),
      ...(authenticatedActorDid && input.creatorDid !== authenticatedActorDid
        ? { submitterDid: existing?.audit?.submitterDid || authenticatedActorDid }
        : {}),
      ...(signingKeyId ? { signingKeyId } : {}),
    } : undefined;
    const record: Record<string, any> = {
      id: recordId,
      ...persistedClaims,
      ...(audit ? { audit } : {}),
      indexed: {
        attributes: buildConfidentialDocumentIndexedAttributes({
          claims: persistedClaims,
          sector: String(input.job.sector || ''),
          audit,
        }),
      },
    };
    if (!alreadyIndexed) {
      await this.vaultRepository.put(input.tenantVaultId, [record as any], sectionId);
    }
    if (
      !isMinimalIndexProjection
      && isResearchFinalized
      && isDigitalTwinResearchResourceType(input.resourceType)
      && isProfessionallyAttestedResearchRecord(persistedClaims)
      && await isDigitalTwinSecondaryUseEnabled({
        vaultRepository: this.vaultRepository,
        tenantVaultId: input.tenantVaultId,
        sourceSubject: subjectRef,
      })
    ) {
      const twinSubjectId = await getOrCreateDigitalTwinSubjectId({
        vaultRepository: this.vaultRepository,
        tenantVaultId: input.tenantVaultId,
        sourceSubject: subjectRef,
      });
      const researchProjection = await resolveAndProjectClaimsForDigitalTwin({
        claims: persistedClaims,
        resourceType: input.resourceType,
        twinSubjectId,
        sector: String(input.job.sector || ''),
        jurisdiction: String(input.job.jurisdiction || ''),
      });
      const researchClaims = researchProjection.claims;
      const researchVersionId = claimsToContentCid(this.clinicalContentVersionClaims(researchClaims)).cid;
      researchClaims[`${input.resourceType}.meta.versionId`] = researchVersionId;
      researchClaims[`org.hl7.fhir.r4.${input.resourceType}.meta.versionId`] = researchVersionId;
      const digitalTwinSectionId = getSubjectScopedSectionId(
        twinSubjectId,
        SUBJECT_SECTION_DIGITAL_TWIN,
        config.collectionId,
      );
      const researchRecordId = createHash('sha256')
        .update(`${input.resourceType}|${recordId}`, 'utf8')
        .digest('hex');
      const priorResearchRecords = await this.vaultRepository.listContainersInSection<any>(
        input.tenantVaultId,
        digitalTwinSectionId,
      );
      const legacyResearchRecordIds = priorResearchRecords
        .filter((priorResearchRecord) =>
          this.normalizeOptionalString(priorResearchRecord?.audit?.sourceRecordId) === recordId
          && this.normalizeOptionalString(priorResearchRecord?.id) !== researchRecordId)
        .map((priorResearchRecord) => String(priorResearchRecord.id));
      const researchAudit = input.creatorDid ? {
        creatorDid: authenticatedActorDid || input.creatorDid,
        sourceRecordId: recordId,
        ...(audit?.submitterDid ? { submitterDid: audit.submitterDid } : {}),
        ...(audit?.signingKeyId ? { signingKeyId: audit.signingKeyId } : {}),
      } : undefined;
      await this.vaultRepository.put(input.tenantVaultId, [{
        id: researchRecordId,
        ...researchClaims,
        ...(researchAudit ? { audit: researchAudit } : {}),
        indexed: {
          attributes: buildConfidentialDocumentIndexedAttributes({
            claims: researchClaims,
            sector: String(input.job.sector || ''),
            audit: researchAudit,
          }),
        },
      } as any], digitalTwinSectionId);
      for (const legacyResearchRecordId of legacyResearchRecordIds) {
        await this.vaultRepository.delete(
          input.tenantVaultId,
          legacyResearchRecordId,
          digitalTwinSectionId,
        );
      }
      let terminologyWarning = researchProjection.warning;
      if (researchProjection.researchReady) {
        terminologyWarning = await this.registerResearchMapping(input.job, buildResearchAssetVersionMapping({
          resourceType: input.resourceType,
          sourceResourceId: recordId,
          sourceVersionId: versionId,
          twinSubjectId,
          claims: researchClaims,
        })) || terminologyWarning;
      }
      return {
        recordId,
        versionId,
        created: !alreadyIndexed,
        ...(terminologyWarning ? { terminologyWarning } : {}),
      };
    }
    return { recordId, versionId, created: !alreadyIndexed };
  }

  /** Ledger outages do not roll back the private SOS clinical write. */
  private async registerResearchMapping(
    job: JobRequest,
    mapping: ResearchAssetVersionMapping,
  ): Promise<OperationOutcome | undefined> {
    if (!this.blockchainAdapter?.registerResearchVersionMappings) return undefined;
    try {
      const submitted = await this.blockchainAdapter.registerResearchVersionMappings(
        [mapping],
        resolveResearchDataChannel(job.sector, job.jurisdiction),
        ClinicalEvidenceChaincode,
      );
      if (submitted.accepted !== 1) {
        throw new Error(`Research registration accepted ${submitted.accepted}/1 resources.`);
      }
      return undefined;
    } catch (error) {
      console.error('[ResearchLedger] Registration failed after private projection.', error);
      return createOperationOutcome(
        IssueLevel.Warning,
        IssueType.Processing,
        'Research registration is temporarily unavailable.',
      );
    }
  }

  /** True only for tagged rows inside an explicitly SUBSETTED document index projection. */
  private isMinimalDocumentIndexResource(
    resource: Record<string, any>,
    isSubsettedDocumentIndex: boolean,
  ): boolean {
    if (!resource || typeof resource !== 'object' || Array.isArray(resource)) return false;
    return isSubsettedDocumentIndex
      && typeof resource.resourceType === 'string'
      && resource.resourceType.trim().length > 0
      && typeof resource.id === 'string'
      && resource.id.trim().length > 0
      && Array.isArray(resource?.meta?.tag);
  }

  /**
   * Uses the standard FHIR SUBSETTED tag on the Bundle itself as the explicit
   * operation-mode marker. Child `resource.meta.tag` values remain ordinary
   * resource metadata unless the enclosing document carries this marker.
   */
  private isSubsettedDocumentBundle(parsed: any): boolean {
    const documentBundle = this.asDocumentBundle(parsed);
    if (!documentBundle || !Array.isArray(documentBundle?.meta?.tag)) return false;
    return documentBundle.meta.tag.some((tag: any) =>
      tag?.system === FHIR_SUBSETTED_TAG_SYSTEM && tag?.code === FHIR_SUBSETTED_TAG_CODE);
  }

  /**
   * Resolves explicit authorship independently from the authenticated sender.
   * Document Bundles use their native Composition; section Bundles carry the
   * projected author in resource.meta.claims. Only self-authoring falls back
   * to the authenticated actor.
   */
  private resolveClinicalResourceAuthor(
    job: JobRequest,
    entry: any,
    fhirResource: FhirCommunication,
  ): string | undefined {
    const commandClaims = normalizeContextualizedClaims({
      ...(entry?.resource?.meta?.claims && typeof entry.resource.meta.claims === 'object'
        ? entry.resource.meta.claims
        : {}),
    });
    const commandAuthor = this.getFirstClaimValue(commandClaims, [
      CompositionClaim.Author,
      'org.hl7.fhir.r4.Composition.author',
    ]);
    const attachmentAuthor = this.resolveCommunicationAttachments(entry, fhirResource)
      .map((resolved) => this.parseAttachmentJson(resolved.documentAttachment))
      .map((resource) => resource?.meta?.claims && typeof resource.meta.claims === 'object'
        ? normalizeContextualizedClaims(resource.meta.claims as Record<string, any>)
        : {})
      .map((claims) => this.getFirstClaimValue(claims, [
        CompositionClaim.Author,
        'org.hl7.fhir.r4.Composition.author',
      ]))
      .find(Boolean);
    const composition = this.extractCompositionResourceFromCommunication(entry, fhirResource);
    const compositionClaims = composition?.meta?.claims && typeof composition.meta.claims === 'object'
      ? normalizeContextualizedClaims(composition.meta.claims as Record<string, any>)
      : {};
    const claimedAuthor = this.getFirstClaimValue(compositionClaims, [
      CompositionClaim.Author,
      'org.hl7.fhir.r4.Composition.author',
    ]);
    const nativeAuthor = Array.isArray(composition?.author)
      ? composition.author
        .map((author: any) => this.normalizeOptionalString(author?.reference))
        .filter(Boolean)
        .join(',')
      : undefined;
    return claimedAuthor?.split(',')[0]?.trim()
      || nativeAuthor?.split(',')[0]?.trim()
      || attachmentAuthor?.split(',')[0]?.trim()
      || commandAuthor?.split(',')[0]?.trim()
      || getAuthenticatedJobActorIdentifiers(job)[0];
  }

  private async persistClinicalAuthorIdentityBinding(
    job: JobRequest,
    tenantVaultId: string,
    authorDid: string | undefined,
  ): Promise<void> {
    const authenticatedDid = getAuthenticatedJobActorIdentifiers(job)
      .find((identifier) => identifier.startsWith('did:web:'));
    if (!authenticatedDid) return;
    const verifiedContacts = getAuthenticatedJobActorIdentifiers(job)
      .filter((identifier) => !identifier.startsWith('did:web:'));
    const sectionId = getClinicalCreatorBindingsSectionId();
    const bindingRecords = await this.vaultRepository.listContainersInSection(tenantVaultId, sectionId);
    const bindings = (bindingRecords as unknown[]).filter(isClinicalCreatorBinding);
    const evidence = clinicalCreatorEvidence(job);
    const stableBinding = resolveClinicalCreatorBinding(bindings, evidence);
    if (stableBinding) {
      const authorBelongsToBinding = !authorDid
        || authorDid === authenticatedDid
        || authorDid === stableBinding.ownerIdentifier
        || authorDid === stableBinding.authorIdentifier;
      if (!authorBelongsToBinding) return;
      await this.vaultRepository.put(tenantVaultId, [{
        ...stableBinding,
        id: stableBinding.authorIdentifier,
        actorDids: Array.from(new Set([...(stableBinding.actorDids || []), authenticatedDid])),
        verifiedContactIdentifiers: Array.from(new Set([
          ...(stableBinding.verifiedContactIdentifiers || []),
          ...verifiedContacts,
        ])),
        dcrClientIds: Array.from(new Set([
          ...(stableBinding.dcrClientIds || []),
          ...(evidence.dcrClientId ? [evidence.dcrClientId] : []),
        ])),
        keyIds: Array.from(new Set([
          ...(stableBinding.keyIds || []),
          ...(evidence.keyId ? [evidence.keyId] : []),
        ])),
      } as any], sectionId);
      return;
    }
    if (!authorDid || authorDid !== authenticatedDid || verifiedContacts.length === 0) return;
    const id = createHash('sha256').update(authorDid, 'utf8').digest('hex');
    const existing = await this.vaultRepository.get<{ id: string; verifiedContacts?: string[] }>(
      tenantVaultId,
      id,
      sectionId,
    );
    await this.vaultRepository.put(tenantVaultId, [{
      id,
      verifiedContacts: Array.from(new Set([
        ...(Array.isArray(existing?.verifiedContacts) ? existing.verifiedContacts : []),
        ...verifiedContacts,
      ])),
    }], sectionId);
  }

  private async isAuthenticatedClinicalAuthor(
    job: JobRequest,
    tenantVaultId: string,
    authorDids: string[],
  ): Promise<boolean> {
    const authenticatedIdentifiers = getAuthenticatedJobActorIdentifiers(job);
    if (authorDids.some((authorDid) => authenticatedIdentifiers.includes(authorDid))) return true;
    const sectionId = getClinicalCreatorBindingsSectionId();
    const bindingRecords = await this.vaultRepository.listContainersInSection(tenantVaultId, sectionId);
    const bindings = (bindingRecords as unknown[]).filter(isClinicalCreatorBinding);
    const stableBinding = resolveClinicalCreatorBinding(bindings, clinicalCreatorEvidence(job));
    if (
      (stableBinding?.actorDids || []).some((actorDid) => authorDids.includes(actorDid))
      || Boolean(stableBinding?.authorIdentifier && authorDids.includes(stableBinding.authorIdentifier))
    ) return true;
    const verifiedContacts = authenticatedIdentifiers.filter((identifier) => !identifier.startsWith('did:web:'));
    if (verifiedContacts.length === 0) return false;
    for (const authorDid of authorDids) {
      const id = createHash('sha256').update(authorDid, 'utf8').digest('hex');
      const binding = await this.vaultRepository.get<{ id: string; verifiedContacts?: string[] }>(
        tenantVaultId,
        id,
        sectionId,
      );
      if (binding?.verifiedContacts?.some((identifier) => verifiedContacts.includes(identifier))) return true;
    }
    return false;
  }

  /** Resolves the exact PractitionerRole or RelatedPerson assignment bound during enrollment. */
  private async resolveAuthenticatedClinicalCreatorBinding(
    job: JobRequest,
    tenantVaultId: string,
  ): Promise<ClinicalCreatorBinding | undefined> {
    const records = await this.vaultRepository.listContainersInSection(
      tenantVaultId,
      getClinicalCreatorBindingsSectionId(),
    );
    return resolveClinicalCreatorBinding(
      (records as unknown[]).filter(isClinicalCreatorBinding),
      clinicalCreatorEvidence(job),
    );
  }

  /**
   * A section write keeps transport and clinical provenance separate: the
   * authenticated DID is the sender, while author and attester must match the
   * stable owner/assignment identities established during enrollment.
   */
  private async requireAuthenticatedSectionProvenance(
    job: JobRequest,
    tenantVaultId: string,
    claims: Record<string, any>,
  ): Promise<void> {
    const binding = await this.resolveAuthenticatedClinicalCreatorBinding(job, tenantVaultId);
    if (!binding) {
      throw new ManagerError(
        'Clinical section write requires an authenticated creator binding.',
        IssueType.Security,
      );
    }
    const author = this.getFirstClaimValue(claims, [CompositionClaim.Author]);
    const allowedAuthors = binding.kind === FhirIpsCreatorKinds.IndividualMember
      ? [binding.ownerIdentifier, binding.authorIdentifier]
      : [binding.ownerIdentifier];
    if (!author || !allowedAuthors.includes(author)) {
      throw new ManagerError(
        'Clinical section author is not allowed by the authenticated creator binding.',
        IssueType.Security,
      );
    }
    const attesters = String(getClaimValue<string>(claims, CompositionClaim.Attester) || '')
      .split(',').map((value) => value.trim()).filter(Boolean);
    if (attesters.length === 0) {
      throw new ManagerError(
        'Clinical section write requires its authenticated assignment attester.',
        IssueType.Security,
      );
    }
    if (attesters.some((attester) => attester !== binding.authorIdentifier)) {
      throw new ManagerError(
        'Clinical section attester must equal the assignment in the authenticated creator binding.',
        IssueType.Security,
      );
    }
    if (!getClaimValue<string>(claims, CompositionClaim.AttesterMode)) {
      claims[CompositionClaim.AttesterMode] = binding.kind === FhirIpsCreatorKinds.Professional
        ? CompositionAttesterModes.Professional
        : CompositionAttesterModes.Personal;
    }
  }

  /** Uses attester identity for current records and author only for legacy records without attesters. */
  private async isAuthenticatedClinicalAttester(
    job: JobRequest,
    tenantVaultId: string,
    attesterIdentifiers: string[],
    legacyAuthorIdentifiers: string[] = [],
  ): Promise<boolean> {
    const authenticatedIdentifiers = getAuthenticatedJobActorIdentifiers(job);
    if (attesterIdentifiers.some((identifier) => authenticatedIdentifiers.includes(identifier))) return true;
    const binding = await this.resolveAuthenticatedClinicalCreatorBinding(job, tenantVaultId);
    if (binding && attesterIdentifiers.some((identifier) =>
      identifier === binding.authorIdentifier
      || identifier === binding.ownerIdentifier
      || binding.actorDids?.includes(identifier))) {
      return true;
    }
    return attesterIdentifiers.length === 0
      && this.isAuthenticatedClinicalAuthor(job, tenantVaultId, legacyAuthorIdentifiers);
  }

  private async isAuthenticatedClinicalAttesterOrSameOwner(
    job: JobRequest,
    tenantVaultId: string,
    attesterIdentifiers: string[],
    authorIdentifiers: string[],
  ): Promise<boolean> {
    if (await this.isAuthenticatedClinicalAttester(
      job,
      tenantVaultId,
      attesterIdentifiers,
      authorIdentifiers,
    )) return true;
    return this.isAuthenticatedClinicalAuthorOrSameOwner(job, tenantVaultId, authorIdentifiers);
  }

  private async isAuthenticatedClinicalAuthorOrSameOwner(
    job: JobRequest,
    tenantVaultId: string,
    authorIdentifiers: string[],
  ): Promise<boolean> {
    if (await this.isAuthenticatedClinicalAuthor(job, tenantVaultId, authorIdentifiers)) return true;
    const records = await this.vaultRepository.listContainersInSection(
      tenantVaultId,
      getClinicalCreatorBindingsSectionId(),
    );
    const bindings = (records as unknown[]).filter(isClinicalCreatorBinding);
    const authenticatedBinding = resolveClinicalCreatorBinding(bindings, clinicalCreatorEvidence(job));
    if (!authenticatedBinding) return false;
    // A governed professional in this tenant may correct personal clinical
    // content. This broader same-owner rule is deliberately never used for DELETE.
    if (authenticatedBinding.kind === FhirIpsCreatorKinds.Professional) return true;

    return authorIdentifiers.some((authorIdentifier) => {
      if (authorIdentifier === authenticatedBinding.ownerIdentifier) return true;
      const sourceBinding = bindings.find((binding) =>
        binding.authorIdentifier === authorIdentifier || binding.actorDids?.includes(authorIdentifier));
      return sourceBinding?.ownerIdentifier === authenticatedBinding.ownerIdentifier;
    });
  }

  private async isRegisteredClinicalAuthor(tenantVaultId: string, authorDid: string): Promise<boolean> {
    const records = await this.vaultRepository.listContainersInSection(
      tenantVaultId,
      getClinicalCreatorBindingsSectionId(),
    );
    return (records as unknown[])
      .filter(isClinicalCreatorBinding)
      .some((binding) => binding.authorIdentifier === authorDid
        || binding.ownerIdentifier === authorDid
        || binding.actorDids?.includes(authorDid));
  }

  private getSupportedProjectedResourceType(resourceType: unknown): SupportedProjectedResourceType | undefined {
    if (typeof resourceType !== 'string') return undefined;
    return Object.prototype.hasOwnProperty.call(PROJECTED_RESOURCE_CONFIG, resourceType)
      ? resourceType as SupportedProjectedResourceType
      : undefined;
  }

  private isDraftConsentRequestBatch(entries: any[]): boolean {
    return entries.length > 0 && entries.every((entry) => {
      const resource = entry?.resource;
      if (resource?.resourceType !== ResourceTypesFhirR4.Consent) return false;
      const claims = normalizeContextualizedClaims(
        normalizeClaimsFromFhirResource(resource as any, {
          identifierClaimKey: ClaimConsent.identifier,
        }) as Record<string, any>,
      );
      return getClaimValue<string>(claims, ClaimConsent.status) === ConsentStatuses.Draft;
    });
  }

  private resolveProjectedResourceSubject(
    claims: Record<string, any>,
    claimKeys: string[],
  ): string | undefined {
    const subject = this.getFirstClaimValue(claims, claimKeys);
    return subject?.replace(/^Patient\//i, '').trim() || undefined;
  }

  private resolveProjectedResourceCanonicalSubject(
    resourceSubjectRef: string | undefined,
    communicationSubject: string | undefined,
  ): string {
    const normalizedResourceSubject = String(resourceSubjectRef || '').replace(/^Patient\//i, '').trim();
    const normalizedCommunicationSubject = String(communicationSubject || '').replace(/^Patient\//i, '').trim();
    if (!normalizedResourceSubject) return normalizedCommunicationSubject;
    if (!normalizedCommunicationSubject) return normalizedResourceSubject;

    const looksLikeLocalBundleSubject =
      /^urn:/i.test(normalizedResourceSubject)
      || /^https?:\/\//i.test(normalizedResourceSubject)
      || /^Patient\//i.test(String(resourceSubjectRef || '').trim());
    return looksLikeLocalBundleSubject ? normalizedCommunicationSubject : normalizedResourceSubject;
  }

  private getFirstClaimValue(claims: Record<string, any>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = getClaimValue<string>(claims, key);
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  }

  private extractProjectedResourceClaims(
    resourceType: SupportedProjectedResourceType,
    resource: Record<string, any>,
    communicationSubject: string | undefined,
    fhirResource: FhirCommunication,
    authorDid?: string,
    documentClaims?: Record<string, unknown>,
  ): Record<string, any> {
    const rawEmbeddedClaims = resource?.meta?.claims && typeof resource.meta.claims === 'object'
      ? resource.meta.claims as Record<string, any>
      : {};
    const embeddedClaims = Object.keys(rawEmbeddedClaims).length > 0
      ? normalizeContextualizedClaims(rawEmbeddedClaims)
      : {};
    const nativeResource = {
      ...resource,
      ...(resource?.meta ? { meta: { ...resource.meta, claims: undefined } } : {}),
    };
    const nativeClaims = normalizeClaimsFromFhirResource(nativeResource as any, {
        identifierClaimKey: `${resourceType}.identifier`,
      }) as Record<string, any>;
    const definedNativeClaims = Object.fromEntries(Object.entries(nativeClaims)
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== ''));
    const indexTagClaims = this.extractMinimalDocumentIndexTagClaims(resourceType, resource);
    const embeddedVersionId = getClaimValue<string>(embeddedClaims, `${resourceType}.meta.versionId`);
    const baseClaims = normalizeContextualizedClaims(embeddedVersionId
      ? { ...indexTagClaims, ...embeddedClaims, ...definedNativeClaims }
      : { ...indexTagClaims, ...definedNativeClaims, ...embeddedClaims });
    baseClaims['@context'] = baseClaims['@context'] || 'org.hl7.fhir.api';
    if (typeof resource?.status === 'string' && resource.status.trim()) {
      const context = String(baseClaims['@context'] || '').replace(/\.$/, '');
      delete baseClaims[`${resourceType}.status`];
      baseClaims[`${context}.${resourceType}.status`] = resource.status.trim();
    }
    if (resourceType === ResourceTypesFhirR4.Observation) {
      const nativeEventTimings = Array.isArray(resource?.effectiveTiming?.repeat?.when)
        ? resource.effectiveTiming.repeat.when
        : [];
      const eventTiming = String(
        getClaimValue(rawEmbeddedClaims, 'Observation.effectiveTiming.repeat.when')
        || getClaimValue(rawEmbeddedClaims, 'Observation.date-when')
        || nativeEventTimings.join(',')
        || '',
      ).trim();
      if (eventTiming) {
        const context = String(baseClaims['@context'] || '').replace(/\.$/, '');
        baseClaims[`${context}.Observation.date-when`] = eventTiming;
      }
    }
    if (authorDid) baseClaims[CompositionClaim.Author] = authorDid;
    for (const claimName of [
      CompositionClaim.Identifier,
      CompositionClaim.Author,
      CompositionClaim.Attester,
      CompositionClaim.AttesterMode,
      CompositionClaim.AttesterTime,
      CompositionClaim.Custodian,
      CompositionClaim.Date,
      CompositionClaim.Type,
      CompositionClaim.Title,
    ]) {
      const value = getClaimValue(documentClaims || {}, claimName);
      if (value !== undefined && value !== null && String(value).trim()) {
        baseClaims[claimName] = value;
      }
    }

    const resourceSubjectRef = String(
      resource?.subject?.reference
      || resource?.patient?.reference
      || '',
    ).trim();
    const subjectRef = this.resolveProjectedResourceCanonicalSubject(resourceSubjectRef, communicationSubject);
    if (subjectRef) {
      baseClaims[`${resourceType}.subject`] = subjectRef;
      if (resourceType === 'AllergyIntolerance' || resourceType === 'Immunization' || resourceType === 'RelatedPerson') {
        baseClaims[`${resourceType}.patient`] = subjectRef;
      }
    }

    const language = String(resource?.language || (fhirResource as any)?.language || '').trim();
    if (language) baseClaims[`${resourceType}.language`] = language;

    const codeableText = String(
      baseClaims[`${resourceType}.code-text`]
      || resource?.code?.text
      || resource?.medicationCodeableConcept?.text
      || resource?.vaccineCode?.text
      || resource?.category?.[0]?.text
      || '',
    ).trim();
    const codeCoding = resource?.code?.coding?.[0]
      || resource?.medicationCodeableConcept?.coding?.[0]
      || resource?.vaccineCode?.coding?.[0]
      || resource?.category?.[0]?.coding?.[0];
    const codeDisplay = String(
      baseClaims[`${resourceType}.code-display`]
      || codeCoding?.display
      || '',
    ).trim();
    if (codeDisplay && !baseClaims[`${resourceType}.code-display`]) {
      baseClaims[`${resourceType}.code-display`] = codeDisplay;
    }
    if (codeableText && !baseClaims[`${resourceType}.code-text`]) {
      baseClaims[`${resourceType}.code-text`] = codeableText;
    }
    const userSelectedRaw = codeCoding?.userSelected;
    if (typeof userSelectedRaw === 'boolean') {
      baseClaims[`${resourceType}.user-selected`] = String(userSelectedRaw);
    }

    if (resourceType === 'MedicationStatement') {
      if (!baseClaims['MedicationStatement.user-selected']) {
        baseClaims['MedicationStatement.user-selected'] = 'true';
      }
    }

    const normalizedClaims = normalizeContextualizedClaims(baseClaims);
    for (const claimName of [
      CompositionClaim.Identifier,
      CompositionClaim.Author,
      CompositionClaim.Attester,
      CompositionClaim.AttesterMode,
      CompositionClaim.AttesterTime,
      CompositionClaim.Custodian,
      CompositionClaim.Date,
      CompositionClaim.Type,
      CompositionClaim.Title,
    ]) {
      const value = getClaimValue(documentClaims || {}, claimName);
      if (value !== undefined && value !== null && String(value).trim()) {
        normalizedClaims[claimName] = value;
      }
    }
    if (authorDid && !normalizedClaims[CompositionClaim.Author]) {
      normalizedClaims[CompositionClaim.Author] = authorDid;
    }
    return normalizedClaims;
  }

  /**
   * Converts allowlisted FHIR `meta.tag` codings into flat searchable claims.
   * Extra, malformed, or cross-resource tags are intentionally ignored.
   */
  private extractMinimalDocumentIndexTagClaims(
    resourceType: SupportedProjectedResourceType,
    resource: Record<string, any>,
  ): Record<string, string> {
    const allowed = MINIMAL_DOCUMENT_INDEX_TAG_CLAIMS[resourceType];
    if (!allowed || !Array.isArray(resource?.meta?.tag)) return {};
    const grouped = new Map<string, string[]>();
    for (const candidate of resource.meta.tag) {
      const system = typeof candidate?.system === 'string' ? candidate.system.trim() : '';
      const code = typeof candidate?.code === 'string' ? candidate.code.trim() : '';
      if (!system || !code || !allowed.has(system) || !system.startsWith(`${resourceType}.`)) continue;
      const values = grouped.get(system) || [];
      if (!values.includes(code)) values.push(code);
      grouped.set(system, values);
    }
    return Object.fromEntries(Array.from(grouped, ([claim, values]) => [claim, values.join(',')]));
  }

  private buildIndexedAttributesFromClaims(
    claims: Record<string, any>,
  ): Array<{ name: string; value: string; unique?: boolean }> {
    const attributes: Array<{ name: string; value: string; unique?: boolean }> = [];
    for (const [key, value] of Object.entries(claims)) {
      if (key === '@context' || key === '@type' || value === undefined || value === null || Array.isArray(value)) {
        continue;
      }
      const normalized = String(value).trim();
      if (!normalized) continue;
      attributes.push({
        name: key,
        value: normalized,
        unique: key.endsWith('.identifier') || key.endsWith('.identifier.value'),
      });
    }
    return attributes;
  }

  private clinicalContentVersionClaims(claims: Record<string, any>): Record<string, any> {
    const documentOnlyClaims = [
      CompositionClaim.Identifier,
      CompositionClaim.Attester,
      CompositionClaim.AttesterMode,
      CompositionClaim.AttesterTime,
      CompositionClaim.Custodian,
      CompositionClaim.Date,
      CompositionClaim.Type,
      CompositionClaim.Title,
    ];
    return Object.fromEntries(Object.entries(claims).filter(([name]) =>
      !documentOnlyClaims.some((claimName) => name === claimName || name.endsWith(`.${claimName}`))));
  }

  private extractSearchBody(job: JobRequest): Record<string, unknown> {
    const body = job.content?.body as Record<string, any> | undefined;
    if (!body || typeof body !== 'object') {
      return { resourceType: FHIR_PARAMETERS_RESOURCE_TYPE, parameter: [] };
    }
    if (body.resourceType === FHIR_PARAMETERS_RESOURCE_TYPE) {
      return body;
    }
    if (Array.isArray(body.entry)) {
      const parameterResource = body.entry.find((entry) => entry?.resource?.resourceType === FHIR_PARAMETERS_RESOURCE_TYPE)?.resource;
      if (parameterResource && typeof parameterResource === 'object') {
        return parameterResource;
      }
    }
    return body;
  }

  private async searchCommunicationChannelRecords(
    tenantVaultId: string,
    criteria: ReturnType<typeof parseCommunicationParticipantSearchCriteria>,
  ): Promise<Array<Record<string, any>>> {
    const sectionIds = await this.resolveCommunicationSearchSectionIds(tenantVaultId, criteria);
    const recordsById = new Map<string, Record<string, any>>();
    const protectedEqualityGroups = await this.protectCommunicationSearchEqualityGroups(criteria, tenantVaultId);

    for (const sectionId of sectionIds) {
      const records = await this.vaultRepository.listContainersInSection<ConfidentialStorageDoc>(tenantVaultId, sectionId);
      for (const storedRecord of records) {
        if (String(storedRecord?.contentType || (storedRecord as any)?.type || '').trim() !== COMMUNICATION_ENTRY_TYPE) {
          continue;
        }
        if (!this.matchesProtectedCommunicationGroups(storedRecord, protectedEqualityGroups)) continue;
        const content = await this.kmsService.unprotectConfidentialData<unknown>(storedRecord, tenantVaultId);
        const claims = this.readCommunicationStorageClaims(content);
        const record: Record<string, any> = { id: storedRecord.id, ...claims };
        if (!matchesCommunicationParticipantSearch({
          subject: record?.[CommunicationClaim.Subject],
          sender: record?.[CommunicationClaim.Sender] || record?.from,
          recipients: record?.[CommunicationClaim.Recipient] || record?.to,
          from: record?.from,
          to: record?.to,
          sent: record?.[CommunicationClaim.Sent],
          category: record?.[CommunicationClaim.Category],
          topic: record?.[CommunicationClaim.Topic],
        }, {
          ...criteria,
          subjectActorIds: [], anySubject: true,
          actorIds: [], anyActor: true,
          senderActorIds: [], anySender: true,
          recipientActorIds: [], anyRecipient: true,
          userActorIds: [], anyUser: true,
          targetActorIds: [], anyTarget: true,
          claimSearchParams: {},
        })) {
          continue;
        }
        const stableId = this.normalizeOptionalString(record.id)
          || this.normalizeOptionalString(record[CommunicationClaim.Identifier])
          || determineResourceId(record?.thid, process.env.NODE_ENV);
        if (!recordsById.has(stableId)) {
          recordsById.set(stableId, record);
        }
      }
    }

    return Array.from(recordsById.values()).sort((left, right) => {
      const leftSent = this.normalizeOptionalString(left?.[CommunicationClaim.Sent]) || '';
      const rightSent = this.normalizeOptionalString(right?.[CommunicationClaim.Sent]) || '';
      return leftSent.localeCompare(rightSent);
    });
  }

  private async resolveCommunicationSearchSectionIds(
    tenantVaultId: string,
    criteria: ReturnType<typeof parseCommunicationParticipantSearchCriteria>,
  ): Promise<string[]> {
    if (!criteria.anySubject && criteria.subjectActorIds.length > 0) {
      return criteria.subjectActorIds.map((subjectActorId) =>
        getSubjectScopedSectionId(subjectActorId, SUBJECT_SECTION_INDIVIDUAL, COMMUNICATION_SECTION_NAME));
    }

    const sectionIds = await this.vaultRepository.getAllSections(tenantVaultId);
    return sectionIds.filter((sectionId) => String(sectionId || '').startsWith(COMMUNICATION_SECTION_PREFIX));
  }

  private buildSearchResponseClaims(record: Record<string, any>): Record<string, unknown> {
    const optionalClaims = {
      '@context': Format.FHIR_API,
      [CommunicationClaim.Identifier]: this.normalizeOptionalString(record[CommunicationClaim.Identifier]) || this.normalizeOptionalString(record.id),
      [CommunicationClaim.Status]: this.normalizeOptionalString(record[CommunicationClaim.Status]),
      [CommunicationClaim.Subject]: this.normalizeOptionalString(record[CommunicationClaim.Subject]),
      [CommunicationClaim.Sender]: this.normalizeOptionalString(record[CommunicationClaim.Sender]) || this.normalizeOptionalString(record.from),
      [CommunicationClaim.Recipient]: this.normalizeOptionalString(record[CommunicationClaim.Recipient])
        || this.joinSearchResponseRecipients(record.to),
      [CommunicationClaim.Sent]: this.normalizeOptionalString(record[CommunicationClaim.Sent]),
      [CommunicationClaim.Category]: this.normalizeOptionalString(record[CommunicationClaim.Category]),
      [CommunicationClaim.Topic]: this.normalizeOptionalString(record[CommunicationClaim.Topic]),
      [CommunicationClaim.ContentReference]: this.normalizeOptionalString(record[CommunicationClaim.ContentReference]),
      [CommunicationClaim.ContentAttachmentType]: this.normalizeOptionalString(record[CommunicationClaim.ContentAttachmentType]),
      [CommunicationClaim.ContentAttachmentData]: this.normalizeOptionalString(record[CommunicationClaim.ContentAttachmentData]),
      [CommunicationClaim.ContentAttachmentTitle]: this.normalizeOptionalString(record[CommunicationClaim.ContentAttachmentTitle]),
      ...(this.normalizeOptionalString(record[CommunicationClaim.NoteText])
        ? { [CommunicationClaim.NoteText]: this.normalizeOptionalString(record[CommunicationClaim.NoteText]) }
        : {}),
      ...(this.normalizeOptionalString(record[CommunicationClaim.PartOf]) || this.normalizeOptionalString(record.thid)
        ? { [CommunicationClaim.PartOf]: this.normalizeOptionalString(record[CommunicationClaim.PartOf])
          || this.normalizeOptionalString(record.thid) }
        : {}),
    };
    return canonicalizeFhirClaims(Object.fromEntries(
      Object.entries(optionalClaims).filter(([, value]) =>
        typeof value === 'string' && value.trim().length > 0),
    ), Format.FHIR_API);
  }

  private normalizeCommunicationStorageClaims(rawClaims: Record<string, unknown> | undefined): Record<string, string> {
    if (!rawClaims || typeof rawClaims !== 'object' || Array.isArray(rawClaims)) {
      throw new ManagerError('Communication requires resource.meta.claims.', IssueType.Required);
    }
    const normalized = canonicalizeFhirClaims(
      normalizeContextualizedClaims(rawClaims as Record<string, any>),
      Format.FHIR_API,
    );
    const allowed = new Set<string>(['@context', '@type', ...Object.values(CommunicationClaim)]);
    const result: Record<string, string> = {};
    for (const [name, value] of Object.entries(normalized)) {
      if (!allowed.has(name) && name.startsWith(`${COMMUNICATION_RESOURCE_TYPE}.`)) {
        throw new ManagerError(`Unsupported Communication claim '${name}'.`, IssueType.Invalid);
      }
      if (!allowed.has(name)) continue;
      if (typeof value !== 'string' || !value.trim()) {
        throw new ManagerError(`Communication claim '${name}' must be a non-empty string.`, IssueType.Invalid);
      }
      result[name] = value.trim();
    }
    return result;
  }

  private projectNativeCommunicationStorageClaims(
    entry: any,
    fhirResource: FhirCommunication,
  ): Record<string, string> {
    const firstAttachment = this.resolveCommunicationAttachments(entry, fhirResource)[0]?.documentAttachment;
    const claims: Record<string, string | undefined> = {
      '@context': Format.FHIR_API,
      [CommunicationClaim.Identifier]: this.resolveCommunicationIdentifier(entry, fhirResource),
      [CommunicationClaim.Status]: this.normalizeOptionalString((fhirResource as any).status),
      [CommunicationClaim.Subject]: this.resolveCommunicationSubject(entry, fhirResource),
      [CommunicationClaim.Recipient]: this.resolveCommunicationRecipient(entry, fhirResource),
      [CommunicationClaim.Sender]: this.resolveCommunicationSender(entry, fhirResource),
      [CommunicationClaim.Sent]: this.resolveCommunicationSent(entry, fhirResource),
      [CommunicationClaim.Category]: this.resolveCommunicationCategory(entry, fhirResource),
      [CommunicationClaim.Topic]: this.resolveCommunicationTopic(entry, fhirResource),
      [CommunicationClaim.NoteText]: this.resolveCommunicationNoteTexts(entry, fhirResource).join('\n') || undefined,
      [CommunicationClaim.ContentReference]: this.buildCommunicationContentReferences(
        { content: {} } as JobRequest,
        entry,
        fhirResource,
      ).join(',') || undefined,
      [CommunicationClaim.ContentAttachmentType]: this.normalizeOptionalString(firstAttachment?.contentType),
      [CommunicationClaim.ContentAttachmentData]: this.normalizeOptionalString(firstAttachment?.data),
      [CommunicationClaim.ContentAttachmentTitle]: this.normalizeOptionalString(firstAttachment?.title),
      [CommunicationClaim.ContentAttachmentUrl]: this.normalizeOptionalString(firstAttachment?.url),
    };
    return Object.fromEntries(Object.entries(claims).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0,
    ));
  }

  private communicationScalarIndexAttributes(
    claims: Record<string, string>,
    claimName: string,
  ): Array<{ name: string; value: string; unique: boolean }> {
    return String(claims[claimName] || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => ({ name: claimName, value, unique: false }));
  }

  private async protectCommunicationSearchEqualityGroups(
    criteria: ReturnType<typeof parseCommunicationParticipantSearchCriteria>,
    tenantVaultId: string,
  ): Promise<Array<Array<{ name: string; value: string }>>> {
    const groups: Array<Array<{ name: string; value: string; unique?: boolean }>> = [];
    const addParticipantGroup = (
      values: readonly string[],
      projection: Parameters<typeof buildCommunicationParticipantIndexAttributes>[0],
      indexName: string,
    ) => {
      if (values.length === 0) return;
      const attributes = buildCommunicationParticipantIndexAttributes(projection)
        .filter((attribute) => attribute.name === indexName);
      if (attributes.length > 0) groups.push(attributes);
    };
    addParticipantGroup(criteria.subjectActorIds, { subject: criteria.subjectActorIds }, CommunicationParticipantIndexNames.Subject);
    addParticipantGroup(criteria.senderActorIds, { sender: criteria.senderActorIds }, CommunicationParticipantIndexNames.Sender);
    addParticipantGroup(criteria.recipientActorIds, { recipients: criteria.recipientActorIds }, CommunicationParticipantIndexNames.Recipient);
    for (const values of [criteria.actorIds, criteria.userActorIds, criteria.targetActorIds]) {
      addParticipantGroup(values, { recipients: values }, CommunicationParticipantIndexNames.Participant);
    }
    for (const [name, values] of Object.entries(criteria.claimSearchParams)) {
      const candidates = values.filter((value) => value !== '*').map((value) => ({ name, value, unique: false }));
      if (candidates.length > 0) groups.push(candidates);
    }
    return Promise.all(groups.map((group) =>
      this.kmsService.protectAttributesNameAndValue(group as any, tenantVaultId) as Promise<Array<{ name: string; value: string }>>));
  }

  private matchesProtectedCommunicationGroups(
    record: ConfidentialStorageDoc,
    groups: ReadonlyArray<ReadonlyArray<{ name: string; value: string }>>,
  ): boolean {
    const stored = Array.isArray(record.indexed?.attributes) ? record.indexed.attributes : [];
    return groups.every((alternatives) => alternatives.some((expected) =>
      stored.some((attribute) => attribute.name === expected.name && attribute.value === expected.value)));
  }

  private readCommunicationStorageClaims(content: unknown): Record<string, string> {
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
      throw new ManagerError(
        'Historical native Communication requires an explicit recoverable migration.',
        IssueType.Invalid,
      );
    }
    const value = content as Record<string, unknown>;
    if (Object.keys(value).length !== 1 || !value.claims || typeof value.claims !== 'object' || Array.isArray(value.claims)) {
      throw new ManagerError(
        'Historical native Communication requires an explicit recoverable migration.',
        IssueType.Invalid,
      );
    }
    return this.normalizeCommunicationStorageClaims(value.claims as Record<string, unknown>);
  }

  private joinSearchResponseRecipients(value: unknown): string | undefined {
    if (Array.isArray(value)) {
      const joined = value.map((item) => String(item || '').trim()).filter(Boolean).join(',');
      return joined || undefined;
    }
    return this.normalizeOptionalString(value);
  }

  private extractCommunicationNoteTexts(fhirResource: FhirCommunication): string[] {
    if (!Array.isArray(fhirResource.note)) return [];
    return fhirResource.note
      .map((note) => String(note?.text || '').trim())
      .filter(Boolean);
  }

  private resolveAtomicNoteTexts(payloadCount: number, noteTexts: string[]): Array<string | undefined> {
    if (payloadCount <= 0) return [];
    if (noteTexts.length === 0) return Array.from({ length: payloadCount }, () => undefined);
    if (payloadCount === 1) return [noteTexts.join('\n\n')];
    if (noteTexts.length === 1) return Array.from({ length: payloadCount }, () => noteTexts[0]);
    if (noteTexts.length === payloadCount) return noteTexts.map((noteText) => noteText || undefined);
    return Array.from({ length: payloadCount }, () => noteTexts.join('\n\n'));
  }

  private buildAtomicDataEntry(
    type: DataEntry['type'],
    resource: Record<string, any>,
    noteText?: string,
  ): DataEntry {
    const entryResource = { ...resource };
    const claims: Record<string, any> = {};
    if (noteText) {
      claims[CommunicationClaim.NoteText] = noteText;
      claims[CommunicationClaim.Text] = noteText;
    }

    return {
      type,
      id: uuidv4(),
      resource: Object.keys(claims).length > 0
        ? { ...entryResource, meta: { ...(entryResource.meta || {}), claims } }
        : entryResource,
    };
  }

  /**
   * Converts a FHIR R4 Communication resource into a CommMsgExtended object.
   * (The rest of the method remains the same)
   */
   // ... [rest of the convertFhirToCommMsg method] ...
  public convertFhirToCommMsg(thid: string, fromDid: string, fhirResource: FhirCommunication): CommMsgExtended {
    const bodyData: DataEntry[] = [];
    const noteTexts = this.extractCommunicationNoteTexts(fhirResource);

    // Process `payload` into `Reference` and `Attachment` objects
    if (fhirResource.payload) {
      const atomicNotes = this.resolveAtomicNoteTexts(fhirResource.payload.length, noteTexts);
      fhirResource.payload.forEach((pld, index) => {
        const noteText = atomicNotes[index];
        if (pld.contentReference?.reference) {
          bodyData.push(this.buildAtomicDataEntry(
            'Reference',
            {
              reference: pld.contentReference.reference,
              type: 'Appointment', // This could be made dynamic if needed
            },
            noteText,
          ));
        } else if (pld.contentAttachment?.contentType || pld.contentAttachment?.data || pld.contentAttachment?.title) {
          bodyData.push(this.buildAtomicDataEntry(
            'Attachment',
            {
              contentType: pld.contentAttachment.contentType,
              data: pld.contentAttachment.data,
              title: pld.contentAttachment.title,
            },
            noteText,
          ));
        }
      });
    }

    if (bodyData.length === 0 && noteTexts.length > 0) {
      noteTexts.forEach((noteText) => {
        bodyData.push({
          type: FhirDataTypes.Annotation,
          id: uuidv4(),
          resource: {
            text: noteText,
            meta: { claims: {
              [CommunicationClaim.NoteText]: noteText,
              [CommunicationClaim.Text]: noteText,
            } },
          },
        });
      });
    }
    
    // Helper function to flatten arrays of CodeableConcepts into a single string
    const flattenCodeableConcept = (concepts: any[]): string | undefined => {
      if (!concepts || concepts.length === 0) return undefined;
      return concepts
        .map(concept => concept.coding?.[0] ? `${concept.coding[0].system}|${concept.coding[0].code}` : '')
        .filter(Boolean)
        .join(',');
    };

    // Helper function to flatten arrays of References into a single string
    const flattenReference = (refs: any[]): string | undefined => {
      if (!refs || refs.length === 0) return undefined;
      return refs.map(ref => ref.reference).filter(Boolean).join(',');
    };
    
    return {
      id: uuidv4(),
      type: 'https://didcomm.org/v2/communication', // Standard DIDComm message type for basic communication
      thid: thid,
      to: fhirResource.recipient?.map((ref) => ref.reference).filter((v): v is string => typeof v === 'string' && v.length > 0),
      from: fromDid,
      created_time: fhirResource.sent ? Math.floor(new Date(fhirResource.sent).getTime() / 1000) : undefined,
      body: {
        data: bodyData,
      },
      
      // Flattened FHIR attributes for metadata purposes (currently commented out as per plan)
      // status: fhirResource.status,
      // statusReason: flattenCodeableConcept(fhirResource.statusReason),
      // partOf: flattenReference(fhirResource.partOf),
      // basedOn: flattenReference(fhirResource.basedOn),
      // inResponseTo: flattenReference(fhirResource.inResponseTo),
      // priority: fhirResource.priority,
      // topic: flattenCodeableConcept(fhirResource.topic ? [fhirResource.topic] : []),
      // medium: flattenCodeableConcept(fhirResource.medium),
      // about: flattenReference(fhirResource.about),
      // encounter: fhirResource.encounter?.reference,
    };
  }

  /**
   * Converts one canonical claims-first Communication entry into the internal
   * message model without manufacturing a native FHIR `payload[]`.
   *
   * Native R4 payloads are still consumed by `convertFhirToCommMsg`; claims
   * add only the operation reference, attachment or annotation that is absent
   * from that transport projection.
   */
  private convertCommunicationEntryToCommMsg(
    thid: string,
    fromDid: string,
    entry: any,
    fhirResource: FhirCommunication,
  ): CommMsgExtended {
    const commMsg = this.convertFhirToCommMsg(thid, fromDid, fhirResource);
    const bodyData = commMsg.body?.data || [];
    const claims = this.resolveCommunicationClaims(entry, fhirResource);
    const reference = this.normalizeOptionalString(claims[CommunicationClaim.ContentReference]);
    if (reference && !bodyData.some((item) =>
      item.type === 'Reference'
      && this.normalizeOptionalString((item.resource as any)?.reference) === reference)) {
      bodyData.push(this.buildAtomicDataEntry('Reference', { reference }));
    }

    const claimsAttachment = this.resolveClaimsAttachment(entry, fhirResource);
    if (claimsAttachment) {
      const attachment = claimsAttachment.documentAttachment;
      const duplicate = bodyData.some((item) =>
        item.type === 'Attachment'
        && this.normalizeOptionalString((item.resource as any)?.data)
          === this.normalizeOptionalString(attachment.data)
        && this.normalizeOptionalString((item.resource as any)?.contentType)
          === this.normalizeOptionalString(attachment.contentType));
      if (!duplicate) {
        bodyData.push(this.buildAtomicDataEntry('Attachment', {
          contentType: attachment.contentType,
          data: attachment.data,
          title: attachment.title,
        }));
      }
    }

    const claimText = this.normalizeOptionalString(
      claims[CommunicationClaim.NoteText] || claims[CommunicationClaim.Text],
    );
    if (claimText && bodyData.length === 0) {
      bodyData.push(this.buildAtomicDataEntry('Annotation', { text: claimText }, claimText));
    }
    commMsg.body = { ...commMsg.body, data: bodyData };
    return commMsg;
  }

  /**
   * Resolves the Communication shell without projecting canonical claims into
   * native FHIR fields.
   *
   * `resource.meta.claims` remains the source of truth for API jobs. A native
   * FHIR Communication is accepted as a transport projection, but manager
   * logic reads claims and native fields independently.
   */
  private resolveCommunicationResource(entry: any): FhirCommunication | undefined {
    const resource = entry?.resource && typeof entry.resource === 'object'
      ? entry.resource
      : entry && typeof entry === 'object' ? entry : undefined;
    if (resource?.resourceType === COMMUNICATION_RESOURCE_TYPE) {
      return resource as FhirCommunication;
    }
    const claims = this.resolveCommunicationClaims(entry, resource);
    if (Object.keys(claims).length === 0) return undefined;
    return {
      resourceType: COMMUNICATION_RESOURCE_TYPE,
      status: 'completed',
      meta: { claims },
    } as unknown as FhirCommunication;
  }

  private resolveCommunicationClaims(
    entry: any,
    fhirResource: FhirCommunication | undefined,
  ): Record<string, any> {
    const resourceClaims = (fhirResource as any)?.meta?.claims;
    return {
      ...(resourceClaims && typeof resourceClaims === 'object' && !Array.isArray(resourceClaims)
        ? resourceClaims
        : {}),
    };
  }

  private resolveClaimsAttachment(
    entry: any,
    fhirResource: FhirCommunication,
  ): ResolvedCommunicationAttachment | undefined {
    const claims = this.resolveCommunicationClaims(entry, fhirResource);
    const data = this.normalizeOptionalString(claims[CommunicationClaim.ContentAttachmentData]);
    const contentType = this.normalizeOptionalString(claims[CommunicationClaim.ContentAttachmentType]);
    const title = this.normalizeOptionalString(claims[CommunicationClaim.ContentAttachmentTitle]);
    if (!data && !contentType && !title) return undefined;
    const attachment = { data, contentType, title };
    return {
      transportAttachment: attachment,
      documentAttachment: attachment,
    };
  }

  private resolveCommunicationAttachments(
    entry: any,
    fhirResource: FhirCommunication,
  ): ResolvedCommunicationAttachment[] {
    const resolved: ResolvedCommunicationAttachment[] = [];
    const claimsAttachment = this.resolveClaimsAttachment(entry, fhirResource);
    if (claimsAttachment) resolved.push(claimsAttachment);

    const payloads = Array.isArray((fhirResource as any)?.payload)
      ? (fhirResource as any).payload
      : [];
    for (const payload of payloads) {
      const nativeAttachment = this.resolveCommunicationPayloadAttachment(payload);
      if (!nativeAttachment) continue;
      const duplicate = resolved.some((candidate) =>
        this.normalizeOptionalString(candidate.documentAttachment?.data)
          === this.normalizeOptionalString(nativeAttachment.documentAttachment?.data)
        && this.normalizeOptionalString(candidate.documentAttachment?.contentType)
          === this.normalizeOptionalString(nativeAttachment.documentAttachment?.contentType)
        && this.normalizeOptionalString(candidate.documentAttachment?.title)
          === this.normalizeOptionalString(nativeAttachment.documentAttachment?.title));
      if (!duplicate) resolved.push(nativeAttachment);
    }
    return resolved;
  }

  private resolveCommunicationNoteTexts(
    entry: any,
    fhirResource: FhirCommunication,
  ): string[] {
    const claims = this.resolveCommunicationClaims(entry, fhirResource);
    const claimText = this.normalizeOptionalString(
      claims[CommunicationClaim.NoteText] || claims[CommunicationClaim.Text],
    );
    return Array.from(new Set([
      ...(claimText ? [claimText] : []),
      ...this.extractCommunicationNoteTexts(fhirResource),
    ]));
  }

  private resolveCommunicationIdentifier(entry: any, fhirResource: FhirCommunication): string | undefined {
    const resourceIdentifier = Array.isArray((fhirResource as any)?.identifier)
      ? (fhirResource as any).identifier.find((item: any) => typeof item?.value === 'string')?.value
      : undefined;
    return this.normalizeOptionalString(
      entry?.resource?.meta?.claims?.[CommunicationClaim.Identifier]
      || resourceIdentifier
      || (fhirResource as any)?.id,
    );
  }

  private resolveCommunicationSubject(entry: any, fhirResource: FhirCommunication): string | undefined {
    const raw = this.normalizeOptionalString(
      entry?.resource?.meta?.claims?.[CommunicationClaim.Subject]
      || (fhirResource?.subject as any)?.reference,
    );
    return raw?.replace(/^Patient\//i, '').trim();
  }

  private resolveCommunicationRecipient(entry: any, fhirResource: FhirCommunication): string | undefined {
    const claimValue = entry?.resource?.meta?.claims?.[CommunicationClaim.Recipient];
    if (typeof claimValue === 'string' && claimValue.trim()) return claimValue.trim();
    const recipients = Array.isArray(fhirResource?.recipient)
      ? fhirResource.recipient.map((recipient) => String(recipient?.reference || '').trim()).filter(Boolean)
      : [];
    return recipients.length > 0 ? recipients.join(',') : undefined;
  }

  private resolveCommunicationSender(entry: any, fhirResource: FhirCommunication): string | undefined {
    return this.normalizeOptionalString(
      entry?.resource?.meta?.claims?.[CommunicationClaim.Sender]
      || (fhirResource?.sender as any)?.reference,
    );
  }

  private resolveCommunicationSent(entry: any, fhirResource: FhirCommunication): string | undefined {
    return this.normalizeOptionalString(
      entry?.resource?.meta?.claims?.[CommunicationClaim.Sent]
      || (fhirResource as any)?.sent,
    );
  }

  private resolveCommunicationCategory(entry: any, fhirResource: FhirCommunication): string | undefined {
    const claim = this.normalizeOptionalString(
      entry?.resource?.meta?.claims?.[CommunicationClaim.Category],
    );
    if (claim) return claim;
    const category = Array.isArray((fhirResource as any)?.category)
      ? (fhirResource as any).category[0]
      : undefined;
    return this.resolveCodeableConceptToken(category);
  }

  private resolveCommunicationTopic(entry: any, fhirResource: FhirCommunication): string | undefined {
    const claim = this.normalizeOptionalString(
      entry?.resource?.meta?.claims?.[CommunicationClaim.Topic],
    );
    return claim || this.resolveCodeableConceptToken((fhirResource as any)?.topic);
  }

  private resolveCodeableConceptToken(value: any): string | undefined {
    const coding = Array.isArray(value?.coding) ? value.coding[0] : undefined;
    const system = this.normalizeOptionalString(coding?.system);
    const code = this.normalizeOptionalString(coding?.code);
    if (system && code) return `${system}|${code}`;
    return code || this.normalizeOptionalString(value?.text);
  }

  private buildCommunicationContentReferences(
    _job: JobRequest,
    entry: any,
    fhirResource: FhirCommunication,
  ): string[] {
    const references: string[] = [];
    const claims = this.resolveCommunicationClaims(entry, fhirResource);
    const claimsReference = this.normalizeOptionalString(
      claims[CommunicationClaim.ContentReference],
    );
    if (claimsReference) references.push(claimsReference);

    const payloads = Array.isArray((fhirResource as any)?.payload) ? (fhirResource as any).payload : [];

    for (const payload of payloads) {
      const contentReference = this.normalizeOptionalString(payload?.contentReference?.reference);
      if (contentReference) references.push(contentReference);
    }

    for (const resolved of this.resolveCommunicationAttachments(entry, fhirResource)) {
      const attachment = resolved.documentAttachment;
      const contentType = String(attachment.contentType || 'application/octet-stream').trim();
      const dataBase64 = typeof attachment.data === 'string' ? attachment.data.trim() : '';
      const url = typeof attachment.url === 'string' ? attachment.url.trim() : '';
      if (!dataBase64 && !url) continue;

      const cid = this.deriveAttachmentCid({
        attachmentId: typeof attachment.id === 'string' ? attachment.id : undefined,
        contentType,
        dataBase64: dataBase64 || undefined,
        url: url || undefined,
      });
      if (!cid) continue;

      const recordId = `documentreference-from-communication-${determineResourceId(String(cid), process.env.NODE_ENV)}`;
      references.push(`DocumentReference/${recordId}`);
    }

    return Array.from(new Set(references.filter(Boolean)));
  }

  /**
   * Only a completed Communication commits its attached clinical mutation.
   * `preparation` remains an auditable proposal and `not-done` records its
   * rejection. An omitted status never commits attached clinical state.
   */
  private shouldProjectAttachedClinicalState(entry: any, fhirResource: FhirCommunication): boolean {
    const status = this.normalizeOptionalString(
      entry?.resource?.meta?.claims?.[CommunicationClaim.Status]
      || (fhirResource as any)?.status,
    )?.toLowerCase();
    return status === 'completed';
  }

  private normalizeOptionalString(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    const normalized = String(value).trim();
    return normalized || undefined;
  }

  private resolveCommunicationPayloadAttachment(payload: any): ResolvedCommunicationAttachment | undefined {
    const transportAttachment = payload?.contentAttachment;
    if (!transportAttachment || typeof transportAttachment !== 'object') return undefined;

    const parsed = this.parseAttachmentJson(transportAttachment);
    if (parsed?.resourceType === 'DocumentReference') {
      const documentAttachment = parsed?.content?.[0]?.attachment;
      if (documentAttachment && typeof documentAttachment === 'object') {
        return {
          transportAttachment,
          documentReference: parsed as Record<string, any>,
          documentAttachment,
        };
      }
    }

    return {
      transportAttachment,
      documentAttachment: transportAttachment,
    };
  }

  private parseAttachmentJson(attachment: Record<string, any>): any | undefined {
    const contentType = String(attachment?.contentType || '').toLowerCase();
    const dataBase64 = typeof attachment?.data === 'string' ? attachment.data.trim() : '';
    if (!dataBase64 || !contentType.includes('json')) return undefined;
    try {
      return JSON.parse(Buffer.from(dataBase64, 'base64').toString('utf8'));
    } catch {
      return undefined;
    }
  }

  private extractProjectedFhirResourcesFromAttachment(
    attachment: Record<string, any> | undefined,
    sectionScoped = false,
  ): Array<Record<string, any>> {
    if (!attachment || typeof attachment !== 'object') return [];
    const parsed = this.parseAttachmentJson(attachment);
    if (!parsed || typeof parsed !== 'object') return [];

    const documentBundle = this.asDocumentBundle(parsed);
    if (documentBundle) {
      this.inferDocumentResourceSectionClaims(documentBundle);
      return documentBundle.entry
        .map((bundleEntry: any) => bundleEntry?.resource as Record<string, any> | undefined)
        .filter((resource: Record<string, any> | undefined): resource is Record<string, any> => Boolean(resource?.resourceType));
    }

    const bundleType = String((parsed as any).type || '').toLowerCase();
    if ((parsed as any).resourceType === 'Bundle' && ['batch', 'collection'].includes(bundleType)) {
      const entries = Array.isArray((parsed as any).data)
        ? (parsed as any).data
        : Array.isArray((parsed as any).entry) ? (parsed as any).entry : [];
      const resources = entries
        .map((bundleEntry: any) => bundleEntry?.resource as Record<string, any> | undefined)
        .filter((resource: Record<string, any> | undefined): resource is Record<string, any> => Boolean(resource?.resourceType));
      if (!sectionScoped && resources.some(
        (resource: Record<string, any>) => this.getSupportedProjectedResourceType(resource.resourceType),
      )) {
        throw new Error(
          'Clinical Bundle.type batch/collection requires one explicit Composition.section claim; '
          + 'use updateClinicalSection, or send Bundle.type document with Composition first via updateClinicalSummary.',
        );
      }
      return sectionScoped ? resources : [];
    }

    if (this.getSupportedProjectedResourceType((parsed as any).resourceType)) {
      return [parsed as Record<string, any>];
    }
    return [];
  }

  /**
   * Native EHR documents are allowed to omit `meta.claims`. Preserve their
   * Composition graph by deriving only the missing per-resource section claim
   * from `Composition.section[].entry[]` before normal claims conversion.
   */
  private inferDocumentResourceSectionClaims(documentBundle: any): void {
    const entries = Array.isArray(documentBundle?.entry) ? documentBundle.entry : [];
    const composition = entries
      .map((bundleEntry: any) => bundleEntry?.resource)
      .find((resource: any) => resource?.resourceType === ResourceTypesFhirR4.Composition);
    const sections = Array.isArray(composition?.section) ? composition.section : [];
    const sectionTokensByReference = new Map<string, Set<string>>();
    const entryByReference = new Map<string, any>();

    const entryAliases = (bundleEntry: any): string[] => {
      const resource = bundleEntry?.resource;
      const resourceId = String(resource?.id || '').trim();
      return [
        String(bundleEntry?.fullUrl || '').trim(),
        resourceId,
        resourceId && resource?.resourceType ? `${resource.resourceType}/${resourceId}` : '',
      ].filter(Boolean);
    };
    for (const bundleEntry of entries) {
      for (const alias of entryAliases(bundleEntry)) entryByReference.set(alias, bundleEntry);
    }

    for (const section of sections) {
      const coding = section?.code?.coding?.[0];
      if (!coding?.code) continue;
      const token = coding?.system
        ? this.toCanonicalCodingToken(coding.system, coding.code)
        : String(coding.code).trim();
      for (const item of Array.isArray(section?.entry) ? section.entry : []) {
        const reference = String(item?.reference || '').trim();
        if (!reference) continue;
        const tokens = sectionTokensByReference.get(reference) || new Set<string>();
        tokens.add(token);
        sectionTokensByReference.set(reference, tokens);
      }
    }

    // Supporting resources inherit section membership through direct and
    // transitive references, without assigning unrelated transport records.
    const collectResourceReferences = (value: unknown, target: Set<string>): void => {
      if (Array.isArray(value)) {
        value.forEach((item) => collectResourceReferences(item, target));
        return;
      }
      if (!value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      if (typeof record.reference === 'string' && record.reference.trim()) {
        target.add(record.reference.trim());
      }
      for (const [key, nested] of Object.entries(record)) {
        if (key !== 'reference') collectResourceReferences(nested, target);
      }
    };
    let changed = true;
    while (changed) {
      changed = false;
      for (const bundleEntry of entries) {
        const inheritedTokens = new Set<string>();
        for (const alias of entryAliases(bundleEntry)) {
          for (const token of sectionTokensByReference.get(alias) || []) inheritedTokens.add(token);
        }
        if (inheritedTokens.size === 0) continue;
        const references = new Set<string>();
        collectResourceReferences(bundleEntry?.resource, references);
        for (const reference of references) {
          const referencedEntry = entryByReference.get(reference);
          if (!referencedEntry) continue;
          for (const alias of entryAliases(referencedEntry)) {
            const tokens = sectionTokensByReference.get(alias) || new Set<string>();
            const sizeBefore = tokens.size;
            inheritedTokens.forEach((token) => tokens.add(token));
            sectionTokensByReference.set(alias, tokens);
            if (tokens.size !== sizeBefore) changed = true;
          }
        }
      }
    }

    for (const bundleEntry of entries) {
      const resource = bundleEntry?.resource;
      if (!resource || resource.resourceType === ResourceTypesFhirR4.Composition) continue;
      const tokens = new Set<string>();
      for (const alias of entryAliases(bundleEntry)) {
        for (const token of sectionTokensByReference.get(alias) || []) tokens.add(token);
      }
      if (tokens.size === 0) continue;
      const existingClaims = resource?.meta?.claims && typeof resource.meta.claims === 'object'
        ? resource.meta.claims
        : {};
      if (getClaimValue<string>(existingClaims, CompositionClaim.Section)) continue;
      resource.meta = {
        ...(resource.meta || {}),
        claims: {
          ...existingClaims,
          [CompositionClaim.Section]: Array.from(tokens).join(','),
        },
      };
    }
  }

  private extractCompositionResourceFromCommunication(
    entry: any,
    fhirResource: FhirCommunication,
  ): Record<string, any> | undefined {
    for (const resolved of this.resolveCommunicationAttachments(entry, fhirResource)) {
      const attachment = resolved.documentAttachment;
      if (!attachment || typeof attachment !== 'object') continue;
      const parsed = this.parseAttachmentJson(attachment);
      const documentBundle = this.asDocumentBundle(parsed);
      if (!documentBundle) continue;
      const composition = documentBundle.entry
        .map((bundleEntry: any) => bundleEntry?.resource as Record<string, any> | undefined)
        .find((resource: Record<string, any> | undefined) => resource?.resourceType === 'Composition');
      if (composition) return composition;
    }
    return undefined;
  }

  private asDocumentBundle(parsed: any): any | undefined {
    if (!parsed || parsed.resourceType !== 'Bundle' || !Array.isArray(parsed.entry)) return undefined;
    if (String(parsed.type || '').toLowerCase() !== 'document') return undefined;
    return parsed;
  }

  private parseDocumentBundle(jsonText: string): any | undefined {
    const parsed = JSON.parse(jsonText);
    return this.asDocumentBundle(parsed);
  }
}

function isClinicalCreatorBinding(value: unknown): value is ClinicalCreatorBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.kind === 'string'
    && typeof record.actorIdentifier === 'string'
    && typeof record.authorIdentifier === 'string'
    && typeof record.ownerIdentifier === 'string'
    && typeof record.role === 'string';
}

function clinicalCreatorEvidence(job: JobRequest): AuthenticatedClinicalCreatorEvidence {
  const identifiers = getAuthenticatedJobActorIdentifiers(job);
  const actorDid = identifiers.find((identifier) => identifier.startsWith('did:web:'));
  const bearer = (job.content as any)?.meta?.bearer?.jwt?.payload || {};
  const protectedHeader = (job.content as any)?.meta?.jws?.protected || {};
  return {
    actorDid,
    verifiedContactIdentifiers: identifiers.filter((identifier) => !identifier.startsWith('did:web:')),
    dcrClientId: String((job.content as any)?.client_id || bearer.client_id || bearer.azp || '').trim() || undefined,
    keyId: String(protectedHeader.kid || '').trim() || undefined,
  };
}
