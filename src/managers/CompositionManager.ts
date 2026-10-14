// src/managers/CompositionManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import type { BundleEntryResponse, BundleJsonApi, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import type { RecordBase } from 'gdc-common-utils-ts/models/resource-document';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import {
  DataCollectionIds,
  HealthcareBasicSections,
  ResourceTypesFhirR4,
} from 'gdc-common-utils-ts/constants/index';
import { createOperationOutcome } from '../utils/outcome';
import {
  buildFhirClaimKeys,
  getClaimValue,
  getFirstClaimValueByKeys,
  normalizeContextualizedClaims,
} from '../utils/claims';
import {
  filterCommunicationMatches,
  filterCompositionMatchesBySectionsAndTypes,
  filterDocumentReferenceMatches,
} from '../utils/composition-search';
import {
  extractTokenCode,
} from '../utils/fhir-data-utils';
import { getTenantVaultId } from '../utils/tenant';
import { getSubjectScopedSectionId, SubjectSectionScope } from '../utils/individual-sections';
import { getEnvSectionId } from '../utils/section-env';
import {
  extractLedgerSafeResearchTags,
  normalizeFhirIngestionFormat,
  SupportedFhirIngestionFormat,
  validateFhirPayloadByVersion,
} from '../utils/fhir-ingestion';
import { determineResourceId } from '../utils/resource';
import { applyFhirCidVersioningToEntry, FhirCidVersionMapping, registerFhirCidMappings } from '../utils/fhir-versioning';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import type { IJobProcessor } from './registry';
import type { IBlockchainAdapter } from '../adapters/IBlockchainAdapter';
import { SUBJECT_SECTION_DIGITAL_TWIN, SUBJECT_SECTION_INDIVIDUAL } from '../constants/domain';
import { getAuthenticatedJobActorDid } from '../utils/authenticated-job-actor';
import {
  extractCompositionExcludedSearchSections,
  extractCompositionSearchSections,
  extractCompositionSearchSubject,
  extractCompositionSearchTypes,
  extractCommunicationSearchFilters,
  extractDocumentReferenceSearchFilters,
  extractRequestedBundleType,
  extractSearchResourceType,
} from '../utils/search-request';
import { GatewayLocalFhirResourceTypes } from '../shared/fhir-constants';
import { GatewayResponseEntryTypes } from '../shared/gateway-response-types';
import { BundleType } from '../utils/bundle';
import type { ITenantsManager } from './ITenantsManager';
import { TwinCompositionManager } from './TwinCompositionManager';
import { buildSearchMatchesResponse, buildTransactionResponse } from '../utils/didcomm-response';
import { buildConsolidatedIpsBundleDocument, projectSummaryBundleByFormat } from '../utils/ips-bundle';
import {
  isDigitalTwinSubjectId,
  isRegisteredDigitalTwinSubjectId,
} from '../utils/digital-twin-research-projection';
import { purgeDigitalTwinSubjectLink } from '../utils/digital-twin-secondary-use';
import { constrainSmartCompositionReadSections } from '../utils/smart-scope-route-authorization';

const RESEARCHER_WORKING_SELECTION_TYPE = 'Composition:ResearcherWorkingSelection';

/**
 * Canonical HL7 IPS "all sections" example used to validate the current
 * section-first digital twin search contract:
 * https://build.fhir.org/ig/HL7/fhir-ips/en/Bundle-bundle-ips-all-sections.json.html
 *
 * The gateway exposes those sections through the shared healthcare catalogs
 * published by `gdc-common-utils-ts`.
 */
export const IPS_ALL_SECTIONS_EXAMPLE_URL =
  'https://build.fhir.org/ig/HL7/fhir-ips/en/Bundle-bundle-ips-all-sections.json.html' as const;

/**
 * Internal subject-scoped storage collection ids used to fan out a digital
 * twin `ResearchSubject/_search` into resource-family indexes through the
 * ResearchSubject's canonical Composition.
 *
 * These are not IPS section tokens and they are not equivalent to
 * `HealthcareSummarySections`:
 * - `HealthcareSummarySections` is the public/documental section taxonomy
 *   expressed as LOINC tokens
 * - `DIGITAL_TWIN_RESOURCE_COLLECTION_IDS` is the private persistence taxonomy
 *   expressed as per-family collection suffixes such as `medications` or
 *   `observations`
 */
const SUMMARY_OPERATION_ACTION = '$summary';
const SUMMARY_OPERATION_CANONICAL_RESOURCE_TYPE = 'subject';
const SUMMARY_OPERATION_ALIAS_RESOURCE_TYPE = 'patient';
const SUMMARY_OPERATION_RESEARCHSUBJECT_RESOURCE_TYPE = 'researchsubject';
const SUMMARY_OPERATION_ALLOWED_SECTOR_PREFIXES = Object.freeze([
  'health-',
  'animal-',
  'onehealth-',
] as const);

type NormalizedCompositionJobContext = {
  body: any;
  entries: any[];
  normalizedSection: string;
  normalizedFormatRaw: string;
  normalizedFormat: SupportedFhirIngestionFormat;
  normalizedAction: string;
  normalizedResourceType: string;
  jurisdiction: string;
  isSummaryOperation: boolean;
  scope: SubjectSectionScope;
};

type CompositionSearchContext = {
  tenantVaultId: string;
  searchResourceType: string;
  useDocumentReferenceSection: boolean;
  useCommunicationSection: boolean;
  searchSubject?: string;
  searchSections: string[];
  excludedSearchSections: string[];
  searchTypes: string[];
  requestedBundleType: string;
  documentReferenceFilters: { identifier?: string; attachmentHash?: string };
  communicationFilters: {
    identifier?: string;
    thid?: string;
    pthid?: string;
    attachmentHash?: string;
  };
};

/**
 * Legacy/compatibility manager for direct `Composition` and `Bundle` jobs.
 *
 * Current responsibility boundary:
 * - `individual`
 *   - still handles the lower-level direct `Composition` / `Bundle` routes
 *     that remain exposed for compatibility
 *   - still resolves the internal `Subject/$summary` operation and direct
 *     document retrieval
 *   - is also called indirectly by `CommunicationManager` when a
 *     `Communication` envelope embeds `Subject/$summary` or `Bundle/_search`
 * - `digitaltwin`
 *   - ingestion of pre-converted twin `Composition` payloads still lands here
 *   - public twin search semantics no longer belong conceptually to this class
 *   - those are delegated to `TwinCompositionManager`
 *
 * Important clarification:
 * - the canonical application/BFF read boundary for `individual` is the
 *   actor facade submitting a `Communication` carrying structured requests
 * - `Subject/$summary`, `Bundle/_search` and direct
 *   `individual/.../Composition` routes are not application-facing calls
 * - the direct `individual/.../Composition` routes therefore exist mainly as
 *   compatibility / lower-level plumbing and test anchors
 * - an external author URN is preserved as provenance on first import, but a
 *   local controller cannot replace that Composition under the same id;
 *   repeating the URN is not source authentication
 */
export class CompositionManager implements IJobProcessor {
  private readonly twinCompositionManager: TwinCompositionManager;

  constructor(
    private readonly vaultRepository: IVaultRepository,
    private readonly blockchainAdapter?: IBlockchainAdapter,
    private readonly tenantsCacheManager?: ITenantsManager,
  ) {
    this.twinCompositionManager = new TwinCompositionManager(vaultRepository);
  }

  private async tenantExists(tenantVaultId: string): Promise<boolean> {
    if (this.tenantsCacheManager) {
      return this.tenantsCacheManager.tenantExists(tenantVaultId);
    }
    return this.vaultRepository.vaultExists(tenantVaultId);
  }

  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const context = this.normalizeJobContext(job);

    if (context.normalizedAction === '_purge') {
      return this.handleDigitalTwinSubjectLinkPurge(job, context);
    }
    if (context.normalizedAction === '_search' || context.isSummaryOperation) {
      return this.handleSearch(job, context);
    }

    return this.handleBatch(job, context);
  }

  private normalizeJobContext(job: JobRequest): NormalizedCompositionJobContext {
    const body = job.content?.body as any;
    const normalizedSection = String(job.section || '').trim().toLowerCase();
    const normalizedFormatRaw = String(job.format || '').trim();
    const normalizedAction = String(job.action || '').trim();
    const normalizedResourceType = String(job.resourceType || '').trim().toLowerCase();
    const jurisdiction = String(job.jurisdiction || '').trim();
    const isSummaryOperation = normalizedAction === SUMMARY_OPERATION_ACTION;

    if (!job.tenantId || !job.sector) {
      throw new Error('Missing tenantId or sector.');
    }
    if (!jurisdiction) {
      throw new Error('Missing required job.jurisdiction.');
    }
    if (!normalizedSection) {
      throw new Error('Missing required job.section.');
    }
    if (!normalizedFormatRaw) {
      throw new Error('Missing required job.format.');
    }
    if (!normalizedAction) {
      throw new Error('Missing required job.action.');
    }
    const isDigitalTwinLinkPurge = normalizedAction === '_purge'
      && normalizedSection === SUBJECT_SECTION_INDIVIDUAL
      && normalizedResourceType === SUMMARY_OPERATION_RESEARCHSUBJECT_RESOURCE_TYPE;
    if (normalizedAction !== '_batch' && normalizedAction !== '_search' && !isSummaryOperation && !isDigitalTwinLinkPurge) {
      throw new Error(`Unsupported action '${normalizedAction}' for CompositionManager.`);
    }
    if (
      isSummaryOperation
      && !(
        (normalizedSection === SUBJECT_SECTION_DIGITAL_TWIN && normalizedResourceType === SUMMARY_OPERATION_RESEARCHSUBJECT_RESOURCE_TYPE)
        || (
          normalizedSection !== SUBJECT_SECTION_DIGITAL_TWIN
          && normalizedResourceType === SUMMARY_OPERATION_CANONICAL_RESOURCE_TYPE
        )
        || (
          normalizedSection !== SUBJECT_SECTION_DIGITAL_TWIN
          && normalizedResourceType === SUMMARY_OPERATION_ALIAS_RESOURCE_TYPE
        )
      )
    ) {
      throw new Error(`Unsupported resourceType '${job.resourceType}' for CompositionManager summary operation.`);
    }
    if (normalizedSection !== SUBJECT_SECTION_INDIVIDUAL && normalizedSection !== SUBJECT_SECTION_DIGITAL_TWIN) {
      throw new Error(`Unsupported section '${normalizedSection}' for CompositionManager.`);
    }
    if (isSummaryOperation && !this.isSupportedSummarySector(String(job.sector || ''))) {
      throw new Error(`Unsupported sector '${job.sector}' for summary operation.`);
    }

    return {
      body,
      entries: (Array.isArray(body?.data) && body.data) || (Array.isArray(body?.entry) && body.entry) || [],
      normalizedSection,
      normalizedFormatRaw,
      normalizedFormat: normalizeFhirIngestionFormat(normalizedFormatRaw),
      normalizedAction,
      normalizedResourceType,
      jurisdiction,
      isSummaryOperation,
      scope: normalizedSection === SUBJECT_SECTION_DIGITAL_TWIN ? SUBJECT_SECTION_DIGITAL_TWIN : SUBJECT_SECTION_INDIVIDUAL,
    };
  }

  private async handleDigitalTwinSubjectLinkPurge(
    job: JobRequest,
    context: NormalizedCompositionJobContext,
  ): Promise<IDecodedDidcommPayload> {
    const sourceSubject = extractCompositionSearchSubject(context.body);
    if (!sourceSubject) throw new Error('Missing required parameter: subject.');

    const tenantVaultId = getTenantVaultId(job.sector as string, job.tenantId as string);
    if (!await this.tenantExists(tenantVaultId)) {
      throw new Error(`Tenant vault not found: ${tenantVaultId}`);
    }
    const result = await purgeDigitalTwinSubjectLink({
      vaultRepository: this.vaultRepository,
      tenantVaultId,
      sourceSubject,
    });
    return buildTransactionResponse(job, {
      resourceType: 'Parameters',
      parameter: [{ name: 'purged', valueBoolean: result.purged }],
    } as any);
  }

  private async handleSearch(
    job: JobRequest,
    context: NormalizedCompositionJobContext,
  ): Promise<IDecodedDidcommPayload> {
    const search = await this.buildSearchContext(job, context);

    if (
      context.normalizedSection === SUBJECT_SECTION_DIGITAL_TWIN
      && search.searchSubject
      && !await isRegisteredDigitalTwinSubjectId({
        vaultRepository: this.vaultRepository,
        tenantVaultId: search.tenantVaultId,
        twinSubjectId: search.searchSubject,
      })
    ) {
      throw new Error('Digital twin subject must be a tenant-registered urn:uuid identifier.');
    }

    if (this.isIpsBundleDocumentRequest(search.searchResourceType, search.requestedBundleType, search.searchTypes)) {
      const consolidatedBundle = await buildConsolidatedIpsBundleDocument({
        vaultRepository: this.vaultRepository,
        tenantVaultId: search.tenantVaultId,
        subject: search.searchSubject!,
        scope: context.scope,
        requiredSections: search.searchSections,
        excludedSections: search.excludedSearchSections,
        requiredTypes: search.searchTypes,
      });
      const projectedBundle = projectSummaryBundleByFormat(consolidatedBundle, context.normalizedFormat);

      return buildTransactionResponse(job, {
        resourceType: ResourceTypesFhirR4.Bundle,
        type: BundleType.BatchResponse,
        data: [{
          type: context.isSummaryOperation ? GatewayResponseEntryTypes.BundleSummary : GatewayResponseEntryTypes.BundleSearch,
          resource: projectedBundle,
          response: { status: '200' },
        } as any],
        total: 1,
      });
    }

    if (context.normalizedSection === SUBJECT_SECTION_DIGITAL_TWIN && search.searchResourceType === 'composition' && !search.searchSubject) {
      const matches = await this.twinCompositionManager.searchBySectionAndClaims({
        tenantVaultId: search.tenantVaultId,
        requiredSections: search.searchSections,
        excludedSections: search.excludedSearchSections,
        body: context.body,
        authenticatedActorDid: getAuthenticatedJobActorDid(job),
        filterMatchesBySectionsAndTypes: this.filterMatchesBySectionsAndTypes.bind(this),
      });

      return buildSearchMatchesResponse(job, GatewayResponseEntryTypes.CompositionSearch, matches);
    }

    const sectionId = getSubjectScopedSectionId(
      search.searchSubject!,
      context.scope,
      search.useDocumentReferenceSection ? 'document-references' : search.useCommunicationSection ? 'communications' : 'composition',
    );
    const matchesRaw = await this.vaultRepository.listContainersInSection(search.tenantVaultId, sectionId);
    const matches = search.useDocumentReferenceSection
      ? this.filterDocumentReferenceMatches(matchesRaw, search.documentReferenceFilters)
      : search.useCommunicationSection
        ? await filterCommunicationMatches(
          this.vaultRepository,
          search.tenantVaultId,
          search.searchSubject!,
          context.scope,
          matchesRaw,
          search.communicationFilters,
        )
        : this.filterMatchesBySectionsAndTypes(
          matchesRaw,
          search.searchSections,
          search.excludedSearchSections,
          search.searchTypes,
        );

    const responseType = search.useDocumentReferenceSection
      ? GatewayResponseEntryTypes.DocumentReferenceSearch
      : search.useCommunicationSection
        ? GatewayResponseEntryTypes.CommunicationSearch
        : GatewayResponseEntryTypes.CompositionSearch;

    return buildSearchMatchesResponse(job, responseType, matches);
  }

  private async buildSearchContext(
    job: JobRequest,
    context: NormalizedCompositionJobContext,
  ): Promise<CompositionSearchContext> {
    const tenantVaultId = getTenantVaultId(job.sector as string, job.tenantId as string);
    const tenantExists = await this.tenantExists(tenantVaultId);
    if (!tenantExists) throw new Error(`Tenant vault not found: ${tenantVaultId}`);

    const searchResourceType = context.isSummaryOperation
      ? 'bundle'
      : extractSearchResourceType(context.body);
    const searchSubject = extractCompositionSearchSubject(context.body);
    if (!searchSubject && context.normalizedSection !== SUBJECT_SECTION_DIGITAL_TWIN) {
      throw new Error('Missing required subject search parameter for Composition search.');
    }

    const requestedSections = extractCompositionSearchSections(context.body);
    const searchSections = context.isSummaryOperation && context.scope === SUBJECT_SECTION_INDIVIDUAL
      ? constrainSmartCompositionReadSections({
          bearerPayload: (job.content as any)?.meta?.bearer?.jwt?.payload,
          subject: searchSubject!,
          requestedSections,
        })
      : requestedSections;

    return {
      tenantVaultId,
      searchResourceType,
      useDocumentReferenceSection: searchResourceType === 'documentreference',
      useCommunicationSection: searchResourceType === 'communication',
      searchSubject,
      searchSections,
      excludedSearchSections: extractCompositionExcludedSearchSections(context.body),
      searchTypes: context.isSummaryOperation
        ? this.extractSummaryTypes(context.body)
        : extractCompositionSearchTypes(context.body),
      requestedBundleType: context.isSummaryOperation
        ? 'document'
        : extractRequestedBundleType(context.body),
      documentReferenceFilters: extractDocumentReferenceSearchFilters(context.body),
      communicationFilters: extractCommunicationSearchFilters(context.body),
    };
  }

  private async handleBatch(
    job: JobRequest,
    context: NormalizedCompositionJobContext,
  ): Promise<IDecodedDidcommPayload> {
    const responseEntries: (BundleEntryResponse | ErrorEntry)[] = [];
    const cidMappings: FhirCidVersionMapping[] = [];

    for (const entry of context.entries) {
      let rawClaims: Record<string, any> | undefined;
      try {
        const resourceType = String(entry?.resource?.resourceType || entry?.type || '').trim();
        const responseAction = `${context.normalizedAction}-response`;
        if (resourceType === GatewayLocalFhirResourceTypes.OperationOutcome) {
          // Preconversion may include row-level OperationOutcome entries as warnings.
          // They are informational and should not be persisted as Composition claims.
          responseEntries.push({
            type: GatewayResponseEntryTypes.OperationOutcome,
            response: {
              status: '200',
              location: `/${job.tenantId}/cds-${context.jurisdiction}/v1/${job.sector}/${context.normalizedSection}/${context.normalizedFormat}/Composition/${responseAction}`,
              outcome: createOperationOutcome(
                IssueLevel.Information,
                IssueType.Value,
                'Skipped OperationOutcome entry from preconversion payload.',
              ),
            },
          } as any);
          continue;
        }

        rawClaims = entry?.resource?.meta?.claims as Record<string, any> | undefined;

        if (!rawClaims || typeof rawClaims !== 'object') {
          throw new Error('Missing meta.claims for Composition entry.');
        }
        validateFhirPayloadByVersion(context.normalizedFormat, 'Composition', entry);

        const claims = normalizeContextualizedClaims(rawClaims) as Record<string, any>;
        const researchTags = extractLedgerSafeResearchTags(entry);

        const subject = getClaimValue<string>(claims, 'Composition.subject');
        if (!subject) throw new Error('Missing required claim: Composition.subject');

        const section = getClaimValue<string>(claims, 'Composition.section');
        if (!section) throw new Error('Missing required claim: Composition.section');

        const tenantVaultId = getTenantVaultId(job.sector as string, job.tenantId as string);
        const tenantExists = await this.tenantExists(tenantVaultId);
        if (!tenantExists) throw new Error(`Tenant vault not found: ${tenantVaultId}`);

        if (context.normalizedSection === SUBJECT_SECTION_DIGITAL_TWIN) {
          const compositionType = String(claims['@type'] || '').trim();
          if (compositionType !== RESEARCHER_WORKING_SELECTION_TYPE) {
            throw new Error(
              `Direct digital twin Composition writes only accept @type=${RESEARCHER_WORKING_SELECTION_TYPE}.`,
            );
          }
          if (!isDigitalTwinSubjectId(subject)) {
            throw new Error('Digital twin subject must be a valid urn:uuid identifier.');
          }
          if (!await isRegisteredDigitalTwinSubjectId({
            vaultRepository: this.vaultRepository,
            tenantVaultId,
            twinSubjectId: subject,
          })) {
            throw new Error('Digital twin subject is not registered for this tenant.');
          }
        }

        const submittedAuthor = getClaimValue<string>(claims, 'Composition.author');
        const authenticatedAuthor = context.normalizedSection === SUBJECT_SECTION_DIGITAL_TWIN
          ? getAuthenticatedJobActorDid(job)
          : undefined;
        if (authenticatedAuthor && submittedAuthor && submittedAuthor !== authenticatedAuthor) {
          throw new Error('Digital twin working-selection author must match the authenticated employee.');
        }
        const author = authenticatedAuthor || submittedAuthor || job.content?.iss;
        if (!author) throw new Error('Missing required claim: Composition.author');
        claims['Composition.author'] = author;

        const date = getClaimValue<string>(claims, 'Composition.date') || new Date().toISOString();
        const entryRefs = getClaimValue<string>(claims, 'Composition.entry') || '';
        const type = getClaimValue<string>(claims, 'Composition.type') || 'LOINC|60591-5';

        const identifierClaim =
          getClaimValue<string>(claims, 'Composition.identifier') ||
          getClaimValue<string>(claims, 'Composition.identifier.value');
        const fallbackId = determineResourceId(identifierClaim, process.env.NODE_ENV);
        const versioning = applyFhirCidVersioningToEntry({
          entry,
          claims,
          resourceType: 'Composition',
          resourceId: fallbackId,
        });
        const id = String(entry?.resource?.id || fallbackId);

        const record: RecordBase & { meta?: { tag?: any[] }; tag?: any[] } = {
          id,
          ...(claims as any),
        };
        if (researchTags && researchTags.length > 0) {
          record.meta = { tag: researchTags };
          record.tag = researchTags;
        }

        const sectionId = getSubjectScopedSectionId(subject, context.scope, 'composition');
        if (context.normalizedSection === SUBJECT_SECTION_INDIVIDUAL) {
          const existing = await this.vaultRepository.get<RecordBase & Record<string, any>>(
            tenantVaultId,
            id,
            sectionId,
          );
          if (existing?.id === id) {
            const storedAuthor = String(getClaimValue(existing, 'Composition.author') || '').trim();
            const authenticatedActor = String(getAuthenticatedJobActorDid(job) || '').trim();
            if (!storedAuthor || storedAuthor !== submittedAuthor || storedAuthor !== authenticatedActor) {
              throw new ManagerError(
                'A locally authenticated controller cannot replace an externally authored IPS; a repeated author URN is not source authentication.',
                IssueType.Security,
              );
            }
          }
        }
        await this.vaultRepository.put(tenantVaultId, [record], sectionId);
        if (versioning.mapping) cidMappings.push(versioning.mapping);

        responseEntries.push({
          type: 'Composition',
          response: {
            status: '201',
            location: `/${job.tenantId}/cds-${context.jurisdiction}/v1/${job.sector}/${context.normalizedSection}/${context.normalizedFormat}/Composition/${responseAction}`,
          },
          ...(researchTags && researchTags.length > 0 ? { meta: { tag: researchTags } } : {}),
        } as any);
      } catch (e: any) {
        const status = e instanceof ManagerError ? e.status : '400';
        responseEntries.push({
          type: 'Composition',
          resource: { resourceType: ResourceTypesFhirR4.OperationOutcome, meta: { claims: rawClaims || {} } },
          response: {
            status,
            outcome: createOperationOutcome(
              IssueLevel.Error,
              e instanceof ManagerError ? e.code : IssueType.Invalid,
              e?.message || String(e),
            ),
          },
        } as any);
      }
    }

    await registerFhirCidMappings({
      blockchainAdapter: this.blockchainAdapter,
      sector: job.sector as string,
      jurisdiction: context.jurisdiction,
      mappings: cidMappings,
    });

    return buildTransactionResponse(job, {
      resourceType: 'Bundle',
      type: 'batch-response',
      data: responseEntries,
    });
  }

  private isSupportedSummarySector(sector: string): boolean {
    const normalizedSector = String(sector || '').trim().toLowerCase();
    return SUMMARY_OPERATION_ALLOWED_SECTOR_PREFIXES.some((prefix) => normalizedSector.startsWith(prefix));
  }

  private extractSummaryTypes(body: any): string[] {
    const explicitTypes = extractCompositionSearchTypes(body);
    if (explicitTypes.length > 0) return explicitTypes;
    return [HealthcareBasicSections.PatientSummaryDocument.attributeValue];
  }

  private filterDocumentReferenceMatches(
    matches: any[],
    filters: { identifier?: string; attachmentHash?: string },
  ): any[] {
    return filterDocumentReferenceMatches(matches, filters);
  }

  private isIpsBundleDocumentRequest(
    searchResourceType: string,
    requestedBundleType: string,
    requiredTypes: string[],
  ): boolean {
    if (searchResourceType !== 'bundle') return false;
    if (String(requestedBundleType || '').trim().toLowerCase() !== 'document') return false;
    if (!Array.isArray(requiredTypes) || requiredTypes.length === 0) return false;

    const ipsCode = HealthcareBasicSections.PatientSummaryDocument.code;
    return requiredTypes.some((value) => extractTokenCode(value) === ipsCode);
  }

  private filterMatchesBySectionsAndTypes(
    matches: any[],
    requiredSections: string[],
    excludedSections: string[],
    requiredTypes: string[],
  ): any[] {
    return filterCompositionMatchesBySectionsAndTypes(
      matches,
      requiredSections,
      excludedSections,
      requiredTypes,
    );
  }
}
