// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/DocumentReferenceManager.ts
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';

import { randomUUID } from 'crypto';
import { IJobProcessor } from './registry';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { createOperationOutcome } from '../utils/outcome';
import { getClaimValue, normalizeContextualizedClaims } from '../utils/claims';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
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
import { SUBJECT_SECTION_DIGITAL_TWIN, SUBJECT_SECTION_INDIVIDUAL } from '../constants/domain';
import type { ITenantsManager } from './ITenantsManager';

type FhirBundleEntryLike = {
  type?: string;
  fullUrl?: string;
  meta?: { claims?: Record<string, any> };
  resource?: any;
  request?: any;
};

type FhirBundleLike = {
  resourceType?: string;
  type?: string;
  entry?: FhirBundleEntryLike[];
};

/**
 * Stores FHIR DocumentReference-style records as per-subject index entries.
 *
 * Contract:
 * - Endpoint: `/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/DocumentReference/_batch`
 * - Payload supports FHIR Bundle `entry[]` and compatibility envelope `data[]`.
 */
export class DocumentReferenceManager implements IJobProcessor {
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

    for (const entry of entries) {
      const rawClaims = entry?.resource?.meta?.claims;
      try {
        if (!rawClaims || typeof rawClaims !== 'object') {
          throw new ManagerError('Missing meta.claims in DocumentReference entry.', IssueType.Required);
        }
        validateFhirPayloadByVersion(normalizedFormat, 'DocumentReference', entry);

        const claims = normalizeContextualizedClaims(rawClaims);
        const researchTags = extractLedgerSafeResearchTags(entry);
        const subject = getClaimValue<string>(claims, 'DocumentReference.subject');
        if (!subject) {
          throw new ManagerError('Missing DocumentReference.subject claim.', IssueType.Required);
        }

        const tenantVaultId = getTenantVaultId(job.sector, job.tenantId);
        const tenantExists = await this.tenantExists(tenantVaultId);
        if (!tenantExists) throw new ManagerError(`Tenant vault not found: ${tenantVaultId}`, IssueType.NotFound);

        const identifierClaim =
          getClaimValue<string>(claims, 'DocumentReference.identifier') ||
          getClaimValue<string>(claims, 'DocumentReference.identifier.value');
        const fallbackId = determineResourceId(identifierClaim, process.env.NODE_ENV);
        const versioning = applyFhirCidVersioningToEntry({
          entry,
          claims,
          resourceType: ResourceTypesFhirR4.DocumentReference,
          resourceId: fallbackId,
        });
        const id = String(entry?.resource?.id || fallbackId);

        const sectionId = getSubjectScopedSectionId(subject, scope, 'document-references');
        const record: Record<string, any> = { id, ...claims };
        if (researchTags && researchTags.length > 0) {
          record.meta = { tag: researchTags };
          record.tag = researchTags;
        }
        await this.vaultRepository.put(tenantVaultId, [record as any], sectionId);
        if (versioning.mapping) cidMappings.push(versioning.mapping);

        if (this.blockchainAdapter?.registerArtifactBundle && versioning.mapping) {
          await this.blockchainAdapter.registerArtifactBundle({
            assetId: versioning.mapping.cid,
            payload: {
              resourceType: ResourceTypesFhirR4.DocumentReference,
              resourceId: id,
              fullUrl: entry?.fullUrl,
              subject,
              claims,
              resource: entry?.resource,
            },
            channel: `${job.sector}-${jurisdiction.toLowerCase()}`,
          });
        }

        const responseAction = `${normalizedAction}-response`;
        responseEntries.push({
          type: ResourceTypesFhirR4.DocumentReference,
          response: {
            status: String(HttpStatusCodes.Created),
            location: `/${job.tenantId}/cds-${jurisdiction}/v1/${job.sector}/${normalizedSection}/${normalizedFormat}/DocumentReference/${responseAction}`,
          },
          resource: {
            resourceType: ResourceTypesFhirR4.DocumentReference,
            meta: {
              claims,
              ...(researchTags && researchTags.length > 0 ? { tag: researchTags } : {}),
            },
          },
        });
      } catch (e: any) {
        const status = e instanceof ManagerError ? e.status : '400';
        const code = e instanceof ManagerError ? e.code : IssueType.Invalid;
        responseEntries.push({
          type: ResourceTypesFhirR4.DocumentReference,
          resource: { resourceType: ResourceTypesFhirR4.OperationOutcome, meta: { claims: rawClaims || {} } },
          response: {
            status,
            outcome: createOperationOutcome(IssueLevel.Error, code, e?.message || String(e)),
          },
        });
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
        resourceType: ResourceTypesFhirR4.Bundle,
        type: `${normalizedAction}-response`,
        data: responseEntries,
      },
    };
  }
}
