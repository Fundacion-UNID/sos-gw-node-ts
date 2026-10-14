// src/managers/RelatedPersonManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { randomUUID } from 'crypto';
import { IJobProcessor } from './registry';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { createOperationOutcome } from '../utils/outcome';
import { getClaimValue, normalizeContextualizedClaims } from '../utils/claims';
import { determineResourceId } from '../utils/resource';
import { getTenantVaultId } from '../utils/tenant';
import { getSubjectScopedSectionId, SubjectSectionScope } from '../utils/individual-sections';
import {
  extractLedgerSafeResearchTags,
  normalizeFhirIngestionFormat,
  validateFhirPayloadByVersion,
} from '../utils/fhir-ingestion';
import { applyFhirCidVersioningToEntry, FhirCidVersionMapping, registerFhirCidMappings } from '../utils/fhir-versioning';
import type { IBlockchainAdapter } from '../adapters/IBlockchainAdapter';
import { ACTION_PURGE, SUBJECT_SECTION_DIGITAL_TWIN, SUBJECT_SECTION_INDIVIDUAL } from '../constants/domain';
import { EntityLifecycleStatus } from '../gdc-backend-utils-node/models/enums';
import { InteroperableLifecycleStatuses } from 'gdc-common-utils-ts/utils/interoperable-resource-operation';
import type { ITenantsManager } from './ITenantsManager';
import { extractSearchFiltersFromEntry, extractSearchFiltersFromParametersResource } from '../utils/search-request';
import { buildSearchResponseEntries } from '../utils/didcomm-response';
import { GatewayResponseEntryTypes } from '../shared/gateway-response-types';
import { BundleType } from '../utils/bundle';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts';
import { requireExplicitLifecycleResourceId } from '../utils/lifecycle-resource-id';

type FhirBundleEntryLike = {
  type?: string;
  meta?: { claims?: Record<string, any> };
  resource?: any;
  request?: any;
};

type FhirBundleLike = {
  resourceType?: string;
  type?: string;
  entry?: FhirBundleEntryLike[];
};

type StoredRelatedPersonRecord = {
  id: string;
  status?: string;
  meta?: Record<string, any>;
  [key: string]: any;
};

function getEntryClaims(entry: FhirBundleEntryLike): Record<string, any> | undefined {
  const resourceClaims = entry?.resource?.meta?.claims;
  if (resourceClaims && typeof resourceClaims === 'object') {
    return resourceClaims as Record<string, any>;
  }
  return undefined;
}

function getEntryLifecycleStatus(entry: FhirBundleEntryLike): string | undefined {
  const status = entry?.resource?.meta?.status;
  return typeof status === 'string' && status.trim() ? status.trim() : undefined;
}

function normalizeStoredRelatedPersonRecord(record: any): StoredRelatedPersonRecord | undefined {
  if (!record || typeof record !== 'object') return undefined;
  const content = record.content && typeof record.content === 'object' ? record.content : record;
  return {
    ...(content as Record<string, any>),
    ...(typeof record.status === 'string' ? { status: record.status } : {}),
    ...((record.meta && typeof record.meta === 'object') || (content?.meta && typeof content.meta === 'object')
      ? { meta: { ...(record.meta || {}), ...(content?.meta || {}) } }
      : {}),
  } as StoredRelatedPersonRecord;
}

function rejectAccessDecisionAsRelationship(claims: Record<string, any>): void {
  const relationship = String(getClaimValue(claims, 'RelatedPerson.relationship') || '').trim();
  const roles = String(getClaimValue(claims, 'RelatedPerson.role') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const codes = [relationship, ...roles]
    .map((value) => value.split('|').at(-1)?.toUpperCase());
  if (codes.includes('PERMITTED')) {
    throw new ManagerError(
      'PERMITTED is an access decision, not a RelatedPerson relationship or role.',
      IssueType.Invalid,
    );
  }
}

/**
 * Registers and lists subject-scoped related entities using RelatedPerson-style
 * claims.
 *
 * Contract:
 * - Endpoint: `/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/RelatedPerson/_batch`
 * - Payload is a DIDComm message whose body is a FHIR Bundle with `entry[]` and `resource.meta.claims` using `@context: org.hl7.fhir.api`.
 * - `_search` requires one explicit subject/patient and never scans all people.
 * - `RelatedPerson.actor-identifier` keeps the public email, telephone, domain
 *   or identifier used by Consent/blockchain hashing; the resource id remains
 *   a separate opaque lifecycle reference.
 * - `RelatedPerson.relationship` stores kinship/legal relationship, while the
 *   optional `RelatedPerson.role` GDC extension stores comma-separated
 *   functions. The manager rejects PERMITTED in either field because access
 *   decisions belong to Consent. CAREGIVER/ECON/DEPEN CSV values resolve to
 *   active RoleClass semantics; BILL/POWATT resolve to RoleCode. The manager
 *   never infers POWATT merely from controller status.
 */
export class RelatedPersonManager implements IJobProcessor {
  constructor(
    private readonly vaultRepository: IVaultRepository,
    private readonly blockchainAdapter?: IBlockchainAdapter,
    private readonly tenantsCacheManager?: ITenantsManager,
  ) {}

  private async tenantExists(tenantVaultId: string): Promise<boolean> {
    if (this.tenantsCacheManager) {
      return this.tenantsCacheManager.tenantExists(tenantVaultId);
    }
    return this.vaultRepository.vaultExists(tenantVaultId);
  }

  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const thid = job.content?.thid as string | undefined;
    if (!thid) throw new ManagerError('Missing thid.', IssueType.Required);
    const normalizedSection = String(job.section || '').trim().toLowerCase();
    const normalizedFormatRaw = String(job.format || '').trim();
    const normalizedAction = String(job.action || '').trim();
    const jurisdiction = String(job.jurisdiction || '').trim();
    if (!job.tenantId || !job.sector) {
      throw new ManagerError('Missing tenantId or sector.', IssueType.Required);
    }
    if (!jurisdiction || !normalizedSection || !normalizedFormatRaw || !normalizedAction) {
      throw new ManagerError('Missing jurisdiction, section, format, or action.', IssueType.Required);
    }
    if (normalizedSection !== SUBJECT_SECTION_INDIVIDUAL && normalizedSection !== SUBJECT_SECTION_DIGITAL_TWIN) {
      throw new ManagerError(`Unsupported section '${normalizedSection}'.`, IssueType.NotSupported);
    }
    const normalizedFormat = normalizeFhirIngestionFormat(normalizedFormatRaw);
    const scope: SubjectSectionScope =
      normalizedSection === SUBJECT_SECTION_DIGITAL_TWIN ? SUBJECT_SECTION_DIGITAL_TWIN : SUBJECT_SECTION_INDIVIDUAL;

    const bundle = (job.content?.body || {}) as any;
    const entries: FhirBundleEntryLike[] =
      (bundle as FhirBundleLike).entry ||
      (bundle?.data as any[]) ||
      [];

    const responseEntries: any[] = [];
    const cidMappings: FhirCidVersionMapping[] = [];

    if (normalizedAction === '_search') {
      const tenantVaultId = getTenantVaultId(job.sector, job.tenantId);
      const tenantExists = await this.tenantExists(tenantVaultId);
      if (!tenantExists) throw new ManagerError(`Tenant vault not found: ${tenantVaultId}`, IssueType.NotFound);
      const filters = this.extractSearchFilters(bundle);
      const subject = String(filters.patient?.[0] || filters.subject?.[0] || '').trim();
      if (!subject) {
        throw new ManagerError('RelatedPerson search requires an explicit subject or patient.', IssueType.Required);
      }
      const sectionId = getSubjectScopedSectionId(subject, scope, 'related-persons');
      const records = await this.vaultRepository.listContainersInSection<any>(tenantVaultId, sectionId);
      const matches = records
        .map((record) => normalizeStoredRelatedPersonRecord(record))
        .filter((record): record is StoredRelatedPersonRecord => !!record)
        // Purge is represented by an auditable terminal marker in versioned
        // vaults. Current search must hide that marker instead of presenting
        // the purged member as active merely because it is not `inactive`.
        .filter((record) => !isPurgedRelatedPersonRecord(record))
        .filter((record) => this.matchesSearchFilters(record, filters));
      responseEntries.push(...buildSearchResponseEntries(
        GatewayResponseEntryTypes.RelatedPersonSearch,
        matches.map((record) => this.toSearchEntry(record)),
        undefined,
        { resourceType: ResourceTypesFhirR4.Bundle, type: BundleType.Searchset },
      ));
    } else {

    for (const entry of entries) {
        const rawClaims = getEntryClaims(entry);
        try {
          if (!rawClaims || typeof rawClaims !== 'object') {
            throw new ManagerError('Missing resource.meta.claims in RelatedPerson entry.', IssueType.Required);
          }
          validateFhirPayloadByVersion(normalizedFormat, 'RelatedPerson', entry);

          const claims = normalizeContextualizedClaims(rawClaims);
        rejectAccessDecisionAsRelationship(claims);
        const researchTags = extractLedgerSafeResearchTags(entry);
        const subject =
          getClaimValue<string>(claims, 'RelatedPerson.patient') ||
          getClaimValue<string>(claims, 'RelatedPerson.subject');
        if (!subject) {
          throw new ManagerError('Missing RelatedPerson.patient (or RelatedPerson.subject) claim.', IssueType.Required);
        }

        const tenantVaultId = getTenantVaultId(job.sector, job.tenantId);
        const tenantExists = await this.tenantExists(tenantVaultId);
        if (!tenantExists) throw new ManagerError(`Tenant vault not found: ${tenantVaultId}`, IssueType.NotFound);

        const identifierClaim =
          getClaimValue<string>(claims, 'RelatedPerson.identifier') ||
          getClaimValue<string>(claims, 'RelatedPerson.identifier.value');
        const fallbackId = determineResourceId(identifierClaim, process.env.NODE_ENV);
        const versioning = applyFhirCidVersioningToEntry({
          entry,
          claims,
          resourceType: 'RelatedPerson',
          resourceId: fallbackId,
        });
        const id = requireExplicitLifecycleResourceId(
          entry?.resource?.id || fallbackId,
          'RelatedPerson lifecycle',
        );

        const sectionId = getSubjectScopedSectionId(subject, scope, 'related-persons');
        if (normalizedAction === ACTION_PURGE) {
          const existingRaw = await this.vaultRepository.get<any>(tenantVaultId, id, sectionId);
          const existingRecord = normalizeStoredRelatedPersonRecord(existingRaw);
          if (!existingRecord) {
            throw new ManagerError(`RelatedPerson not found for purge: ${id}`, IssueType.NotFound);
          }
          if (existingRecord.status !== EntityLifecycleStatus.Inactive) {
            throw new ManagerError('RelatedPerson must be disabled before purge.', IssueType.Conflict);
          }
          const updatedRecord: Record<string, any> = {
            ...existingRecord,
            status: InteroperableLifecycleStatuses.Purged,
            meta: {
              ...(existingRecord.meta || {}),
              lifecycleDisposition: 'purged',
              lifecyclePurgedAt: new Date().toISOString(),
            },
          };
          await this.vaultRepository.put(tenantVaultId, [updatedRecord as any], sectionId);

          const responseAction = `${normalizedAction}-response`;
          responseEntries.push({
            type: 'RelatedPerson',
            response: {
              status: '200',
              location: `/${job.tenantId}/cds-${jurisdiction}/v1/${job.sector}/${normalizedSection}/${normalizedFormat}/RelatedPerson/${responseAction}`,
            },
            resource: { resourceType: ResourceTypesFhirR4.RelatedPerson, id, meta: {
              claims,
              ...(researchTags && researchTags.length > 0 ? { tag: researchTags } : {}),
            } },
          });
          continue;
        }

        const requestedLifecycleStatus = getEntryLifecycleStatus(entry);
        const record: Record<string, any> = {
          id,
          ...claims,
          ...(requestedLifecycleStatus ? { status: requestedLifecycleStatus } : {}),
        };
        if (researchTags && researchTags.length > 0) {
          record.meta = { tag: researchTags };
          record.tag = researchTags;
        }
        await this.vaultRepository.put(tenantVaultId, [record as any], sectionId);
        if (versioning.mapping) cidMappings.push(versioning.mapping);

        const responseAction = `${normalizedAction}-response`;
        responseEntries.push({
          type: 'RelatedPerson',
          response: {
            status: '201',
            location: `/${job.tenantId}/cds-${jurisdiction}/v1/${job.sector}/${normalizedSection}/${normalizedFormat}/RelatedPerson/${responseAction}`,
          },
          resource: { resourceType: ResourceTypesFhirR4.RelatedPerson, id, meta: {
            claims,
            ...(researchTags && researchTags.length > 0 ? { tag: researchTags } : {}),
          } },
        });
      } catch (e: any) {
        const status = e instanceof ManagerError ? e.status : '400';
        const code = e instanceof ManagerError ? e.code : IssueType.Invalid;
        responseEntries.push({
          type: 'RelatedPerson',
          resource: { resourceType: ResourceTypesFhirR4.OperationOutcome, meta: { claims: rawClaims || {} } },
          response: {
            status,
            outcome: createOperationOutcome(IssueLevel.Error, code, e?.message || String(e)),
          },
        });
      }
    }
    }

    await registerFhirCidMappings({
      blockchainAdapter: this.blockchainAdapter,
      sector: job.sector,
      jurisdiction,
      mappings: cidMappings,
    });

    return {
      jti: randomUUID(),
      type: 'transaction-response',
      thid,
      iss: job.content?.aud as string,
      aud: job.content?.iss as string,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: {
        resourceType: 'Bundle',
        type: `${normalizedAction}-response`,
        total: responseEntries.length,
        data: responseEntries,
      },
    };
  }

  private extractSearchFilters(body: any): Record<string, string[]> {
    if (body?.resourceType === 'Parameters') {
      return extractSearchFiltersFromParametersResource(body);
    }
    const entries: any[] =
      (Array.isArray(body?.entry) && body.entry)
      || (Array.isArray(body?.data) && body.data)
      || [];
    if (entries.length > 0) return extractSearchFiltersFromEntry(entries[0], 'RelatedPerson');
    return {};
  }

  private matchesSearchFilters(
    record: StoredRelatedPersonRecord,
    filters: Record<string, string[]>,
  ): boolean {
    const matches = (filterNames: string[], actual: unknown): boolean => {
      const requested = filterNames.flatMap((name) => filters[name] || []);
      return requested.length === 0 || requested.includes(String(actual ?? '').trim());
    };
    return matches(['identifier'], getClaimValue(record, 'RelatedPerson.identifier') || getClaimValue(record, 'RelatedPerson.identifier.value'))
      && matches(['relationship'], getClaimValue(record, 'RelatedPerson.relationship'))
      && matches(['telecom'], getClaimValue(record, 'RelatedPerson.telecom'))
      && matches(['active'], getClaimValue(record, 'RelatedPerson.active'))
      && matches(['status'], record.status);
  }

  private toSearchEntry(record: StoredRelatedPersonRecord): Record<string, any> {
    const claims: Record<string, any> = {};
    for (const [key, value] of Object.entries(record)) {
      if (key === 'id' || key === 'status' || key === 'meta' || key === 'indexed' || key === 'content') continue;
      claims[key] = value;
    }
    if (!claims['@context']) claims['@context'] = 'org.hl7.fhir.api';
    return {
      type: 'RelatedPerson',
      meta: {
        ...(record.status ? { status: record.status } : {}),
      },
      resource: {
        resourceType: 'RelatedPerson',
        id: record.id,
        meta: {
          ...(record.status ? { status: record.status } : {}),
          claims,
        },
      },
    };
  }
}

function isPurgedRelatedPersonRecord(record: StoredRelatedPersonRecord): boolean {
  return record.status === InteroperableLifecycleStatuses.Purged
    || record.meta?.lifecycleDisposition === 'purged';
}
