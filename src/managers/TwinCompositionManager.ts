import { randomUUID } from 'crypto';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import type { BundleJsonApi } from 'gdc-common-utils-ts/models/bundle';
import {
  DataCollectionIds,
  HealthcareSummarySections,
  ResourceTypesFhirR4,
} from 'gdc-common-utils-ts/constants/index';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { buildFhirClaimKeys, canonicalizeFhirClaims, getClaimValue, getFirstClaimValueByKeys, stripKnownFhirClaimContextPrefix } from '../utils/claims';
import { getEnvSectionId } from '../utils/section-env';
import { getSubjectScopedSectionId } from '../utils/individual-sections';
import { getTenantVaultId } from '../utils/tenant';
import {
  collectSearchFiltersFromBody,
  getSearchFilterValues,
  SearchFilters,
} from '../utils/search-request';
import { SUBJECT_SECTION_DIGITAL_TWIN } from '../constants/domain';
import { getAuthenticatedJobActorDid } from '../utils/authenticated-job-actor';
import { GatewayEnvelopeTypes, GatewayResponseEntryTypes } from '../shared/gateway-response-types';
import { BundleType } from '../utils/bundle';
import { buildSearchResponseEntries } from '../utils/didcomm-response';
import type { IJobProcessor } from './registry';
import {
  DIGITAL_TWIN_SEARCH_DATE_CLAIM,
  DIGITAL_TWIN_SEARCH_TEXT_CLAIM,
} from '../utils/digital-twin-research-projection';
import { buildFhirResourceFromIndexedClaims } from '../utils/fhir-resource-rehydration';

export type TwinCompositionProjectionConfig = {
  collectionIds: string[];
  resourceType: string;
};

export const TWIN_RESOURCE_SEARCH_DATE_CLAIMS: Readonly<Record<string, string>> = Object.freeze({
  MedicationStatement: 'MedicationStatement.effective',
  AllergyIntolerance: 'AllergyIntolerance.onset-datetime',
  Condition: 'Condition.onset-datetime',
  Observation: 'Observation.date',
  DiagnosticReport: 'DiagnosticReport.date',
  Procedure: 'Procedure.date',
  Immunization: 'Immunization.date',
});

export const TWIN_COMPOSITION_SECTION_RESOURCE_CONFIG: Readonly<
Record<string, readonly TwinCompositionProjectionConfig[]>
> = Object.freeze({
  [HealthcareSummarySections.HistoryOfMedicationUse.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.medications], resourceType: ResourceTypesFhirR4.MedicationStatement },
  ]),
  [HealthcareSummarySections.AllergiesAndIntolerances.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.allergies], resourceType: ResourceTypesFhirR4.AllergyIntolerance },
  ]),
  [HealthcareSummarySections.ProblemList.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.conditions], resourceType: ResourceTypesFhirR4.Condition },
  ]),
  [HealthcareSummarySections.Results.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.observations], resourceType: ResourceTypesFhirR4.Observation },
    { collectionIds: [DataCollectionIds.diagnosticReports], resourceType: ResourceTypesFhirR4.DiagnosticReport },
  ]),
  [HealthcareSummarySections.Procedures.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.procedures], resourceType: ResourceTypesFhirR4.Procedure },
  ]),
  [HealthcareSummarySections.Immunizations.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.immunizations], resourceType: ResourceTypesFhirR4.Immunization },
  ]),
  [HealthcareSummarySections.FunctionalStatus.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.conditions], resourceType: ResourceTypesFhirR4.Condition },
  ]),
  [HealthcareSummarySections.PlanOfCare.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.carePlans], resourceType: ResourceTypesFhirR4.CarePlan },
  ]),
  [HealthcareSummarySections.SocialHistory.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.observations], resourceType: ResourceTypesFhirR4.Observation },
  ]),
  [HealthcareSummarySections.VitalSigns.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.observations], resourceType: ResourceTypesFhirR4.Observation },
  ]),
  [HealthcareSummarySections.AdvanceDirectives.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.consents], resourceType: ResourceTypesFhirR4.Consent },
  ]),
  [HealthcareSummarySections.HistoryOfPastIllness.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.conditions], resourceType: ResourceTypesFhirR4.Condition },
  ]),
  [HealthcareSummarySections.PregnancyHistory.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.observations], resourceType: ResourceTypesFhirR4.Observation },
  ]),
  [HealthcareSummarySections.GoalsAndPreferences.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.consents], resourceType: ResourceTypesFhirR4.Consent },
  ]),
  [HealthcareSummarySections.Alert.attributeValue]: Object.freeze([
    { collectionIds: [DataCollectionIds.flags], resourceType: ResourceTypesFhirR4.Flag },
  ]),
  [HealthcareSummarySections.MedicalDevices.attributeValue]: Object.freeze([
    {
      collectionIds: [DataCollectionIds.deviceUseStatements],
      resourceType: ResourceTypesFhirR4.DeviceUseStatement,
    },
  ]),
});

/**
 * Dedicated manager for public digital-twin `ResearchSubject` search.
 *
 * ResearchSubject is the public aggregate and Composition is its internal index.
 * Claims-first `org.hl7.fhir.api` may mix both resource families under one
 * `meta.claims` context. Versioned FHIR responses translate those claims into
 * distinct resources and carry the Composition through `contained[]`; they
 * never expose the claims-first transport map as native FHIR metadata.
 */
export class TwinCompositionManager {
  constructor(
    private readonly vaultRepository: IVaultRepository,
    private readonly compositionFallbackManager?: IJobProcessor,
  ) {}

  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    if (job.action !== '_search') {
      if (!this.compositionFallbackManager) {
        throw new Error('TwinCompositionManager requires a composition fallback manager for non-search actions.');
      }
      return this.compositionFallbackManager.process(job);
    }

    const tenantVaultId = getTenantVaultId(String(job.sector || ''), String(job.tenantId || ''));
    const body = job.content?.body as any;
    const authenticatedActorDid = getAuthenticatedJobActorDid(job);
    const searchSections = this.getSearchFilterValues(body, ['section', 'Composition.section']);
    const excludedSections = this.getSearchFilterValues(body, ['section:not', 'Composition.section:not']);
    const matches = await this.searchBySectionAndClaims({
      tenantVaultId,
      requiredSections: searchSections,
      excludedSections,
      body,
      authenticatedActorDid,
      filterMatchesBySectionsAndTypes: (records, required, excluded) =>
        records.filter((record) => {
          const indexedClaims = this.indexedClaims(record);
          const sectionTokens = String(
            getFirstClaimValueByKeys(indexedClaims, buildFhirClaimKeys('Composition.section')) || '',
          ).split(',').map((value) => value.trim()).filter(Boolean);
          if (sectionTokens.length === 0) return false;
          if (excluded.some((value) => sectionTokens.includes(value))) return false;
          if (required.length > 0 && !required.some((value) => sectionTokens.includes(value))) return false;
          return true;
        }),
    });
    const exposesResearchSubjects = String(job.resourceType || '').trim().toLowerCase() === 'researchsubject';
    const publicMatches = exposesResearchSubjects
      ? matches.map((composition) => this.toResearchSubjectMatch(composition, String(job.format || '')))
      : matches;

    const responseType = exposesResearchSubjects
      ? GatewayResponseEntryTypes.ResearchSubjectSearch
      : GatewayResponseEntryTypes.CompositionSearch;
    const data = buildSearchResponseEntries(responseType, publicMatches);
    const responseBundle: BundleJsonApi = {
      resourceType: ResourceTypesFhirR4.Bundle,
      type: BundleType.BatchResponse,
      data,
      total: data.length,
    };

    return {
      jti: randomUUID(),
      type: GatewayEnvelopeTypes.TransactionResponse,
      thid: job.content?.thid as string,
      iss: job.content?.aud as string,
      aud: job.content?.iss as string,
      body: responseBundle,
    };
  }

  /** Exposes one canonical Composition index through the selected public representation. */
  private toResearchSubjectMatch(composition: Record<string, any>, format: string): Record<string, any> {
    const subject = this.normalizeReference(getClaimValue<string>(this.indexedClaims(composition), 'Composition.subject'));
    if (!subject) throw new Error('Digital twin canonical Composition is missing Composition.subject.');
    const logicalId = subject.startsWith('urn:uuid:') ? subject.slice('urn:uuid:'.length) : subject;

    if (format === 'org.hl7.fhir.r4' || format === 'org.hl7.fhir.r5') {
      const containedComposition = buildFhirResourceFromIndexedClaims('Composition', {
        ...composition,
        ...this.indexedClaims(composition),
      });
      const compositionMeta = containedComposition.meta && typeof containedComposition.meta === 'object'
        ? { ...containedComposition.meta }
        : undefined;
      if (compositionMeta) delete compositionMeta.claims;
      const storedTag = Array.isArray(composition.meta?.tag) ? composition.meta.tag : undefined;
      if (compositionMeta && storedTag) compositionMeta.tag = storedTag;
      return {
        resourceType: 'ResearchSubject',
        id: logicalId,
        identifier: [{ value: subject }],
        status: 'candidate',
        contained: [{
          ...containedComposition,
          resourceType: 'Composition',
          id: String(containedComposition.id || composition.id || logicalId),
          subject: { reference: subject },
          ...(compositionMeta && Object.keys(compositionMeta).length > 0 ? { meta: compositionMeta } : { meta: undefined }),
        }],
      };
    }

    const nestedClaims = composition.meta?.claims && typeof composition.meta.claims === 'object'
      ? composition.meta.claims
      : composition;
    const publicClaims = canonicalizeFhirClaims(nestedClaims, 'org.hl7.fhir.api');
    return {
      resourceType: 'ResearchSubject',
      id: logicalId,
      meta: {
        claims: {
          ...publicClaims,
          'ResearchSubject.identifier': subject,
          'ResearchSubject.status': 'candidate',
        },
      },
    };
  }

  /** Reads persisted claims without changing their claims-first wire shape. */
  private indexedClaims(record: Record<string, any>): Record<string, any> {
    const nested = record?.meta?.claims;
    return nested && typeof nested === 'object' && !Array.isArray(nested)
      ? { ...record, ...nested }
      : record;
  }

  public collectSearchFilters(body: any): SearchFilters {
    return collectSearchFiltersFromBody(body);
  }

  private getSearchFilterValues(body: any, names: string[]): string[] {
    return getSearchFilterValues(body, names);
  }

  public async searchBySectionAndClaims(params: {
    tenantVaultId: string;
    requiredSections: string[];
    excludedSections: string[];
    body: any;
    authenticatedActorDid?: string;
    filterMatchesBySectionsAndTypes: (matches: any[], requiredSections: string[], excludedSections: string[], requiredTypes: string[]) => any[];
  }): Promise<any[]> {
    if (!Array.isArray(params.requiredSections) || params.requiredSections.length === 0) {
      throw new Error('digitaltwin ResearchSubject/_search requires at least one section filter.');
    }

    const filters = this.collectSearchFilters(params.body);
    const basicSearch = this.parseBasicSearch(filters);
    const usesCanonicalSection = Object.keys(filters).some((key) => key.toLowerCase() === 'composition.section');
    if (usesCanonicalSection && Object.keys(filters).some((key) => /\.code-text(?:-local)?$/i.test(key))) {
      throw new Error('Canonical digital twin search supports only <ResourceType>.code-display text filters.');
    }
    const searchesPrivateTags = Object.keys(filters).some((key) => {
      const normalized = stripKnownFhirClaimContextPrefix(String(key || '').trim()).toLowerCase();
      return normalized === 'composition.meta-tag' || normalized === 'composition.meta.tag';
    });
    if (searchesPrivateTags && params.authenticatedActorDid) {
      filters['Composition.author'] = [params.authenticatedActorDid];
    }
    const requestedResourceTypes = new Set<string>();
    for (const key of Object.keys(filters)) {
      const match = /^([A-Za-z][A-Za-z0-9]*)\./.exec(String(key || '').trim());
      if (match?.[1]) requestedResourceTypes.add(match[1]);
    }
    const hasCompositionFilters = requestedResourceTypes.delete(ResourceTypesFhirR4.Composition);
    if (requestedResourceTypes.size === 0 && !hasCompositionFilters && !basicSearch) {
      throw new Error('digitaltwin ResearchSubject/_search requires at least one resource-scoped claim filter.');
    }
    if (basicSearch) {
      return this.searchBasicAcrossSections({ ...params, basicSearch });
    }
    if (requestedResourceTypes.size === 0 && hasCompositionFilters) {
      return this.searchCompositionRecordsByDirectFilters({
        tenantVaultId: params.tenantVaultId,
        requiredSections: params.requiredSections,
        excludedSections: params.excludedSections,
        filters,
        authenticatedActorDid: params.authenticatedActorDid,
        filterMatchesBySectionsAndTypes: params.filterMatchesBySectionsAndTypes,
      });
    }

    if (usesCanonicalSection) {
      for (const resourceType of requestedResourceTypes) {
        const resourceKeys = Object.keys(filters).filter((key) => key.startsWith(`${resourceType}.`));
        const dateClaim = TWIN_RESOURCE_SEARCH_DATE_CLAIMS[resourceType];
        if (!dateClaim
          || !resourceKeys.includes(`${resourceType}.code-display`)
          || !resourceKeys.includes(dateClaim)
          || !filters[dateClaim]?.some((value) => /^ge/i.test(value))) {
          throw new Error(`Canonical digital twin ${resourceType} search requires code-display and a dateFrom range.`);
        }
      }
    }

    this.addImplicitCurrentDateUpperBounds(filters, requestedResourceTypes);
    const allSections = await this.vaultRepository.getAllSections(params.tenantVaultId);
    const matchedSubjectsByResourceType = new Map<string, Set<string>>(
      Array.from(requestedResourceTypes, (resourceType) => [resourceType, new Set<string>()]),
    );

    for (const sectionToken of params.requiredSections) {
      if (params.excludedSections.includes(sectionToken)) continue;
      const projectionConfigs = TWIN_COMPOSITION_SECTION_RESOURCE_CONFIG[sectionToken] || [];
      for (const projectionConfig of projectionConfigs) {
        const requestedResourceType = projectionConfig.resourceType;
        if (!requestedResourceTypes.has(requestedResourceType)) continue;
        for (const collectionId of projectionConfig.collectionIds) {
          const normalizedCollectionId = String(collectionId || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
          const prefix = getEnvSectionId(`${SUBJECT_SECTION_DIGITAL_TWIN}_${normalizedCollectionId}_`);
          const candidateSectionIds = allSections.filter((sectionId) => String(sectionId || '').startsWith(prefix));
          for (const candidateSectionId of candidateSectionIds) {
            const records = await this.vaultRepository.listContainersInSection<any>(params.tenantVaultId, candidateSectionId);
            for (const record of records) {
              if (!this.matchesResourceFilters(record, requestedResourceType, filters)) continue;
              const subject = this.normalizeReference(
                getClaimValue<string>(record, `${requestedResourceType}.subject`)
                || getClaimValue<string>(record, `${requestedResourceType}.patient`),
              );
              if (subject) matchedSubjectsByResourceType.get(requestedResourceType)?.add(subject);
            }
          }
        }
      }
    }

    const resourceSubjectSets = Array.from(matchedSubjectsByResourceType.values());
    const matchedSubjects = new Set<string>(resourceSubjectSets[0] || []);
    for (const resourceSubjects of resourceSubjectSets.slice(1)) {
      for (const subject of matchedSubjects) {
        if (!resourceSubjects.has(subject)) matchedSubjects.delete(subject);
      }
    }

    const compositionMatches: any[] = [];
    for (const subject of matchedSubjects) {
      const compositionSectionId = getSubjectScopedSectionId(subject, SUBJECT_SECTION_DIGITAL_TWIN, DataCollectionIds.composition);
      const records = await this.vaultRepository.listContainersInSection<any>(params.tenantVaultId, compositionSectionId);
      compositionMatches.push(
        ...params.filterMatchesBySectionsAndTypes(
          records,
          params.requiredSections,
          params.excludedSections,
          [],
        ),
      );
    }

    return compositionMatches;
  }

  private parseBasicSearch(filters: SearchFilters): { text: string; fromMs: number; toMs: number } | undefined {
    const text = String(filters.text?.[0] || '').trim();
    const from = String(filters['date-from']?.[0] || '').trim();
    const to = String(filters['date-to']?.[0] || '').trim();
    if (!text && !from && !to) return undefined;
    if (!text) throw new Error('digitaltwin basic search requires text.');
    if (!from) throw new Error('digitaltwin basic search requires date-from.');
    const fromMs = this.parseBoundaryDate(from, false, 'date-from');
    const toMs = to ? this.parseBoundaryDate(to, true, 'date-to') : Date.now();
    if (toMs < fromMs) throw new Error('digitaltwin basic search date-to must be on or after date-from.');
    return { text: this.normalizeSearchText(text), fromMs, toMs };
  }

  private parseBoundaryDate(value: string, endOfDay: boolean, name: string): number {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const normalized = dateOnly ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z` : value;
    const timestamp = Date.parse(normalized);
    if (Number.isNaN(timestamp)) throw new Error(`digitaltwin basic search ${name} must be an ISO date or dateTime.`);
    return timestamp;
  }

  private normalizeSearchText(value: string): string {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  private searchableProjectionText(record: Record<string, any>, resourceType: string): string {
    const derived = String(record?.[DIGITAL_TWIN_SEARCH_TEXT_CLAIM] || '').trim();
    if (derived) return derived;
    return [
      getClaimValue<string>(record, `${resourceType}.code`),
      getClaimValue<string>(record, `${resourceType}.code-display`),
    ].map((value) => String(value || '').trim()).filter(Boolean).join('\u001f');
  }

  private async searchBasicAcrossSections(params: {
    tenantVaultId: string;
    requiredSections: string[];
    excludedSections: string[];
    basicSearch: { text: string; fromMs: number; toMs: number };
    filterMatchesBySectionsAndTypes: (matches: any[], requiredSections: string[], excludedSections: string[], requiredTypes: string[]) => any[];
  }): Promise<any[]> {
    const allSections = await this.vaultRepository.getAllSections(params.tenantVaultId);
    const matchedSectionsBySubject = new Map<string, Set<string>>();
    for (const sectionToken of params.requiredSections) {
      if (params.excludedSections.includes(sectionToken)) continue;
      for (const config of TWIN_COMPOSITION_SECTION_RESOURCE_CONFIG[sectionToken] || []) {
        for (const collectionId of config.collectionIds) {
          const normalizedCollectionId = String(collectionId || '').trim().toLowerCase()
            .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
          const prefix = getEnvSectionId(`${SUBJECT_SECTION_DIGITAL_TWIN}_${normalizedCollectionId}_`);
          for (const sectionId of allSections.filter((candidate) => String(candidate || '').startsWith(prefix))) {
            const records = await this.vaultRepository.listContainersInSection<any>(params.tenantVaultId, sectionId);
            for (const record of records) {
              const searchText = this.normalizeSearchText(this.searchableProjectionText(record, config.resourceType));
              const dateMs = Date.parse(String(record?.[DIGITAL_TWIN_SEARCH_DATE_CLAIM] || ''));
              if (!searchText.includes(params.basicSearch.text)) continue;
              if (Number.isNaN(dateMs) || dateMs < params.basicSearch.fromMs || dateMs > params.basicSearch.toMs) continue;
              const subject = this.normalizeReference(
                getClaimValue<string>(record, `${config.resourceType}.subject`)
                || getClaimValue<string>(record, `${config.resourceType}.patient`),
              );
              if (subject) {
                const matchedSections = matchedSectionsBySubject.get(subject) || new Set<string>();
                matchedSections.add(sectionToken);
                matchedSectionsBySubject.set(subject, matchedSections);
              }
            }
          }
        }
      }
    }
    const matches: any[] = [];
    for (const [subject, matchedSections] of matchedSectionsBySubject) {
      const sectionId = getSubjectScopedSectionId(subject, SUBJECT_SECTION_DIGITAL_TWIN, DataCollectionIds.composition);
      const records = await this.vaultRepository.listContainersInSection<any>(params.tenantVaultId, sectionId);
      const storedMatches = params.filterMatchesBySectionsAndTypes(
        records,
        params.requiredSections,
        params.excludedSections,
        [],
      );
      matches.push(...(storedMatches.length > 0 ? storedMatches : [{
        id: subject.startsWith('urn:uuid:') ? subject.slice('urn:uuid:'.length) : subject,
        'Composition.subject': subject,
        'Composition.section': Array.from(matchedSections).join(','),
      }]));
    }
    return Array.from(new Map(matches.map((match) => [String(match?.id || JSON.stringify(match)), match])).values());
  }

  private async searchCompositionRecordsByDirectFilters(params: {
    tenantVaultId: string;
    requiredSections: string[];
    excludedSections: string[];
    filters: SearchFilters;
    authenticatedActorDid?: string;
    filterMatchesBySectionsAndTypes: (matches: any[], requiredSections: string[], excludedSections: string[], requiredTypes: string[]) => any[];
  }): Promise<any[]> {
    const allSections = await this.vaultRepository.getAllSections(params.tenantVaultId);
    const compositionSectionPrefix = getEnvSectionId(`${SUBJECT_SECTION_DIGITAL_TWIN}_${DataCollectionIds.composition}_`);
    const candidateSectionIds = allSections.filter((sectionId) =>
      String(sectionId || '').startsWith(compositionSectionPrefix),
    );

    const compositionMatches: any[] = [];
    for (const candidateSectionId of candidateSectionIds) {
      const records = await this.vaultRepository.listContainersInSection<any>(params.tenantVaultId, candidateSectionId);
      const sectionMatches = params.filterMatchesBySectionsAndTypes(
        records,
        params.requiredSections,
        params.excludedSections,
        [],
      );
      compositionMatches.push(
        ...sectionMatches.filter((record) => this.matchesCompositionFilters(record, params.filters)),
      );
    }

    return compositionMatches;
  }

  private matchesCompositionFilters(record: Record<string, any>, filters: SearchFilters): boolean {
    const relevantEntries = Object.entries(filters).filter(([key, values]) =>
      String(key || '').startsWith(`${ResourceTypesFhirR4.Composition}.`) && Array.isArray(values) && values.length > 0,
    );
    if (relevantEntries.length === 0) return false;

    return relevantEntries.every(([claimName, values]) => {
      const normalizedClaimName = stripKnownFhirClaimContextPrefix(String(claimName || '').trim()).toLowerCase();
      if (normalizedClaimName === 'composition.meta-tag' || normalizedClaimName === 'composition.meta.tag') {
        return values.every((expectedValue) => this.matchesCompositionMetaTag(record, expectedValue));
      }

      const actualValue = this.readClaimValue(record, claimName);
      if (!actualValue) return false;
      return values.every((expectedValue) => this.matchesClaimValue(claimName, actualValue, expectedValue));
    });
  }

  private matchesResourceFilters(
    record: Record<string, any>,
    resourceType: string,
    filters: SearchFilters,
  ): boolean {
    const relevantEntries = Object.entries(filters).filter(([key, values]) =>
      String(key || '').startsWith(`${resourceType}.`) && Array.isArray(values) && values.length > 0,
    );
    if (relevantEntries.length === 0) return false;

    return relevantEntries.every(([claimName, values]) => {
      const actualValue = this.readClaimValue(record, claimName);
      if (!actualValue) return false;
      return values.every((expectedValue) => this.matchesClaimValue(claimName, actualValue, expectedValue));
    });
  }

  private readClaimValue(record: Record<string, any>, claimName: string): string {
    const normalizedClaimName = stripKnownFhirClaimContextPrefix(String(claimName || '').trim());
    const resourceType = normalizedClaimName.split('.')[0] || '';
    const candidateClaimNames = [
      ...buildFhirClaimKeys(normalizedClaimName),
      normalizedClaimName.replace(/\.code-display$/i, '.CodeDisplay'),
      normalizedClaimName.replace(/\.code-text-local$/i, '.CodeTextLocal'),
      normalizedClaimName.replace(/\.code-text$/i, '.CodeTextLocal'),
      normalizedClaimName.replace(/\.code-text$/i, '.code-text'),
      ...(resourceType === ResourceTypesFhirR4.MedicationStatement && normalizedClaimName.endsWith('.code-text')
        ? ['MedicationStatement.medication-text']
        : []),
    ];

    for (const candidateClaimName of candidateClaimNames) {
      const candidateValue = this.normalizeReference(getClaimValue<string>(this.indexedClaims(record), candidateClaimName));
      if (candidateValue) return candidateValue;
    }

    return '';
  }

  private matchesClaimValue(claimName: string, actualValue: string, expectedValue: string): boolean {
    const normalizedActual = String(actualValue || '').trim();
    const normalizedExpected = String(expectedValue || '').trim();
    if (!normalizedActual || !normalizedExpected) return false;

    const normalizedClaimName = String(claimName || '').trim().toLowerCase();
    if (/^(?:ge|le)/i.test(normalizedExpected)) {
      const comparator = normalizedExpected.slice(0, 2).toLowerCase();
      const expectedDate = Date.parse(normalizedExpected.slice(2));
      const actualDate = Date.parse(normalizedActual);
      if (Number.isNaN(expectedDate) || Number.isNaN(actualDate)) return false;
      return comparator === 'ge' ? actualDate >= expectedDate : actualDate <= expectedDate;
    }
    if (
      normalizedClaimName.endsWith('.code-display')
      || normalizedClaimName.endsWith('.codedisplay')
      || normalizedClaimName.endsWith('.code-text')
      || normalizedClaimName.endsWith('.code-text-local')
      || normalizedClaimName.endsWith('.codetextlocal')
      || normalizedClaimName.endsWith('.medication-text')
      || normalizedClaimName.endsWith('.note')
    ) {
      return normalizedActual.toLowerCase().includes(normalizedExpected.toLowerCase());
    }

    return normalizedActual === normalizedExpected;
  }

  private addImplicitCurrentDateUpperBounds(filters: SearchFilters, resourceTypes: Set<string>): void {
    const currentDate = new Date().toISOString();
    for (const [claimName, values] of Object.entries(filters)) {
      const normalizedClaimName = stripKnownFhirClaimContextPrefix(String(claimName || '').trim());
      const resourceType = normalizedClaimName.split('.')[0] || '';
      if (!resourceTypes.has(resourceType) || !values.some((value) => /^ge/i.test(value))) continue;
      if (!values.some((value) => /^le/i.test(value))) values.push(`le${currentDate}`);
    }
  }

  private matchesCompositionMetaTag(record: Record<string, any>, expectedValue: string): boolean {
    const normalizedExpected = String(expectedValue || '').trim();
    if (!normalizedExpected) return false;

    const [expectedSystem, expectedCode] = normalizedExpected.includes('|')
      ? normalizedExpected.split('|', 2).map((value) => String(value || '').trim())
      : ['', normalizedExpected];
    if (!expectedCode) return false;

    return this.collectResearchTags(record).some((tag) => {
      const actualSystem = String(tag?.system || '').trim();
      const actualCode = String(tag?.code || '').trim();
      if (!actualCode) return false;
      if (expectedSystem) {
        return actualSystem === expectedSystem && actualCode === expectedCode;
      }
      return actualCode === expectedCode;
    });
  }

  private collectResearchTags(record: Record<string, any>): Array<{ system?: string; code?: string }> {
    const directTags = Array.isArray(record?.tag) ? record.tag : [];
    const metaTags = Array.isArray(record?.meta?.tag) ? record.meta.tag : [];
    const uniqueTags = new Map<string, { system?: string; code?: string }>();
    for (const rawTag of [...directTags, ...metaTags]) {
      if (!rawTag || typeof rawTag !== 'object') continue;
      const system = String((rawTag as any).system || '').trim();
      const code = String((rawTag as any).code || '').trim();
      if (!system && !code) continue;
      uniqueTags.set(`${system}|${code}`, { system, code });
    }
    return Array.from(uniqueTags.values());
  }

  private normalizeReference(value: string | undefined): string {
    return String(value || '').trim();
  }
}
