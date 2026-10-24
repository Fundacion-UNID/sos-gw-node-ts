import { randomUUID } from 'crypto';
import { IJobProcessor } from './registry';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { createOperationOutcome } from '../utils/outcome';
import { getClaimValue, normalizeContextualizedClaims } from '../utils/claims';
import { determineResourceId } from '../utils/resource';
import { getTenantVaultId } from '../utils/tenant';
import { getSubjectScopedSectionId, SubjectSectionScope } from '../utils/individual-sections';
import { SUBJECT_SECTION_DIGITAL_TWIN, SUBJECT_SECTION_INDIVIDUAL } from '../constants/domain';
import type { ITenantsManager } from './ITenantsManager';
import { getEnvSectionId } from '../utils/section-env';
import {
  isProfessionallyAttestedResearchRecord,
  markDigitalTwinStudyTargetShared,
  resolveAndProjectClaimsForDigitalTwin,
} from '../utils/digital-twin-research-projection';
import { listEnabledDigitalTwinStudyTargets } from '../utils/digital-twin-secondary-use';
import { buildSearchResponseEntries } from '../utils/didcomm-response';
import { GatewayResponseEntryTypes } from '../shared/gateway-response-types';
import { buildConfidentialDocumentIndexedAttributes } from 'gdc-common-utils-ts/utils/confidential-document-provenance';
import type { OperationOutcome } from 'gdc-common-utils-ts/models/operation-outcome';
import { claimsToContentCid } from 'gdc-common-utils-ts/utils/fhir-cid';
import type { IBlockchainAdapter } from '../adapters/IBlockchainAdapter';
import { ClinicalEvidenceChaincode } from '../utils/ledger';
import {
  buildResearchAssetVersionMapping,
  resolveResearchDataChannel,
} from '../utils/research-asset-versioning';

type FhirBundleEntryLike = {
  type?: string;
  meta?: { claims?: Record<string, any> };
  resource?: any;
};

type FhirBundleLike = {
  resourceType?: string;
  type?: string;
  entry?: FhirBundleEntryLike[];
};

/**
 * Handles the current `MedicationStatement` write/search MVP.
 *
 * Important status note:
 * - This manager supports operational subject-scoped medication persistence.
 * - It also mirrors accepted operational medication updates into the tenant's
 *   `digitaltwin` scope.
 * - The current `digitaltwin/.../MedicationStatement/_search` behavior is a
 *   compatibility route limited to exact coded-claim matching.
 *
 * It is NOT the intended long-term public digital twin contract.
 *
 * Target architecture:
 * - `individual` should not teach direct resource-type `_search` as the main
 *   public read model; operational reads are centered on `Communication`,
 *   `Subject/$summary`, and document retrieval.
 * - `digitaltwin` search should evolve toward `Composition/_search` returning
 *   0..n twin documents, while using internal `MedicationStatement` claims as
 *   matching criteria.
 *
 * Read this manager as "current MVP compatibility/runtime behavior", not as
 * the final research search surface.
 */
export class MedicationStatementManager implements IJobProcessor {
  constructor(
    private readonly vaultRepository: IVaultRepository,
    private readonly tenantsCacheManager?: ITenantsManager,
    private readonly blockchainAdapter?: IBlockchainAdapter,
  ) {}

  private async tenantExists(tenantVaultId: string): Promise<boolean> {
    if (this.tenantsCacheManager) {
      return this.tenantsCacheManager.tenantExists(tenantVaultId);
    }
    return this.vaultRepository.vaultExists(tenantVaultId);
  }

  private async searchDigitalTwinMedications(
    tenantVaultId: string,
    claims: Record<string, any>,
  ): Promise<any[]> {
    const filters = Object.entries(claims)
      .filter(([k, v]) => k !== '@context' && v !== undefined && v !== null && String(v).trim() !== '');
    const hasUnsafeTextFilter = filters.some(([name]) =>
      /(?:^|[.\-_])(display|text|title|description|note|instruction|name|address|telecom|contact|narrative)(?:$|[.\-_])/i.test(name));
    if (hasUnsafeTextFilter) return [];
    const allSections = await this.vaultRepository.getAllSections(tenantVaultId);
    const digitalTwinMedicationPrefix = getEnvSectionId(`${SUBJECT_SECTION_DIGITAL_TWIN}_medications_`);
    const sectionIds = allSections.filter((sectionId) => String(sectionId || '').startsWith(digitalTwinMedicationPrefix));

    const matches: any[] = [];
    for (const sectionId of sectionIds) {
      const records = await this.vaultRepository.listContainersInSection<any>(tenantVaultId, sectionId);
      for (const record of records) {
        const recordMatches = filters.every(([name, value]) => this.matchesDigitalTwinFilter(record, name, String(value).trim()));
        if (recordMatches) matches.push(record);
      }
    }

    return matches;
  }

  private matchesDigitalTwinFilter(record: Record<string, any>, claimName: string, expectedValue: string): boolean {
    const actualValue = this.readRecordClaimValue(record, claimName);
    if (!actualValue || !expectedValue) return false;

    return actualValue === expectedValue;
  }

  private readRecordClaimValue(record: Record<string, any>, claimName: string): string {
    const directValue = getClaimValue<string>(record, claimName);
    if (typeof directValue === 'string' && directValue.trim()) return directValue.trim();

    const canonicalClaimName = String(claimName || '')
      .replace(/^org\.hl7\.fhir\.api\./i, '')
      .replace(/^org\.hl7\.fhir\.r4\./i, '')
      .trim();
    if (canonicalClaimName && canonicalClaimName !== claimName) {
      const canonicalValue = getClaimValue<string>(record, canonicalClaimName);
      if (typeof canonicalValue === 'string' && canonicalValue.trim()) return canonicalValue.trim();
    }

    return '';
  }

  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const thid = job.content?.thid as string | undefined;
    if (!thid) throw new ManagerError('Missing thid.', IssueType.Required);
    const normalizedSection = String(job.section || '').trim().toLowerCase();
    const normalizedAction = String(job.action || '').trim();
    const jurisdiction = String(job.jurisdiction || '').trim();
    if (!job.tenantId || !job.sector) {
      throw new ManagerError('Missing tenantId or sector.', IssueType.Required);
    }
    if (!jurisdiction || !normalizedSection || !normalizedAction) {
      throw new ManagerError('Missing jurisdiction, section, or action.', IssueType.Required);
    }
    if (normalizedSection !== SUBJECT_SECTION_INDIVIDUAL && normalizedSection !== SUBJECT_SECTION_DIGITAL_TWIN) {
      throw new ManagerError(`Unsupported section '${normalizedSection}'.`, IssueType.NotSupported);
    }
    if (normalizedAction !== '_batch' && normalizedAction !== '_search') {
      throw new ManagerError(`Unsupported action '${normalizedAction}' for MedicationStatement.`, IssueType.NotSupported);
    }

    const scope: SubjectSectionScope =
      normalizedSection === SUBJECT_SECTION_DIGITAL_TWIN ? SUBJECT_SECTION_DIGITAL_TWIN : SUBJECT_SECTION_INDIVIDUAL;
    const bundle = (job.content?.body || {}) as any;
    const entries: FhirBundleEntryLike[] =
      (bundle as FhirBundleLike).entry ||
      (bundle?.data as any[]) ||
      [];
    const responseEntries: any[] = [];

    if (normalizedAction === '_batch') {
      for (const entry of entries) {
        const rawClaims = entry?.resource?.meta?.claims;
        try {
          if (!rawClaims || typeof rawClaims !== 'object') {
            throw new ManagerError('Missing meta.claims in MedicationStatement entry.', IssueType.Required);
          }
          const claims = normalizeContextualizedClaims(rawClaims);
          const subject =
            getClaimValue<string>(claims, 'MedicationStatement.subject') ||
            getClaimValue<string>(claims, 'MedicationStatement.patient');
          if (!subject) {
            throw new ManagerError('Missing MedicationStatement.subject claim.', IssueType.Required);
          }

          const tenantVaultId = getTenantVaultId(job.sector, job.tenantId);
          const tenantExists = await this.tenantExists(tenantVaultId);
          if (!tenantExists) throw new ManagerError(`Tenant vault not found: ${tenantVaultId}`, IssueType.NotFound);

          const identifierClaim =
            getClaimValue<string>(claims, 'MedicationStatement.identifier') ||
            getClaimValue<string>(claims, 'MedicationStatement.identifier.value');
          const id = String(entry?.resource?.id || determineResourceId(identifierClaim, process.env.NODE_ENV));
          const indexedAttributes = buildConfidentialDocumentIndexedAttributes({
            claims,
            sector: job.sector,
          });
          const versionId = claimsToContentCid(claims).cid;
          const record = {
            id,
            ...claims,
            indexed: { attributes: indexedAttributes, versionId },
          } as any;
          const sectionId = getSubjectScopedSectionId(subject, scope, 'medications');
          await this.vaultRepository.put(tenantVaultId, [record], sectionId);
          let terminologyWarning: OperationOutcome | undefined;
          if (
            scope === SUBJECT_SECTION_INDIVIDUAL
            && isProfessionallyAttestedResearchRecord(claims)
          ) {
            const studyTargets = await listEnabledDigitalTwinStudyTargets({
              vaultRepository: this.vaultRepository, tenantVaultId, sourceSubject: subject,
            });
            for (const target of studyTargets) {
              const researchProjection = await resolveAndProjectClaimsForDigitalTwin({
                claims, resourceType: 'MedicationStatement', twinSubjectId: target.twinSubjectId,
                sector: job.sector,
                jurisdiction,
              });
              const researchClaims = researchProjection.claims;
              if (target.researchUseReference) {
                researchClaims['__digitalTwinStudy.reference'] = target.researchUseReference;
              }
              const researchId = String(
                researchClaims['MedicationStatement.identifier']
                || researchClaims['org.hl7.fhir.api.MedicationStatement.identifier']
                || determineResourceId(undefined, process.env.NODE_ENV),
              );
              const digitalTwinSectionId = getSubjectScopedSectionId(
                target.twinSubjectId,
                SUBJECT_SECTION_DIGITAL_TWIN,
                'medications',
              );
              await this.vaultRepository.put(tenantVaultId, [{
                id: researchId,
                ...researchClaims,
                indexed: {
                  attributes: buildConfidentialDocumentIndexedAttributes({
                    claims: researchClaims,
                    sector: job.sector,
                  }),
                },
              } as any], digitalTwinSectionId);
              await markDigitalTwinStudyTargetShared({
                vaultRepository: this.vaultRepository,
                tenantVaultId,
                sourceSubject: subject,
                researchUseReference: target.researchUseReference,
              });
              terminologyWarning = terminologyWarning || researchProjection.warning;
              if (researchProjection.researchReady && this.blockchainAdapter?.registerResearchVersionMappings) {
                try {
                  const mapping = buildResearchAssetVersionMapping({
                    resourceType: ResourceTypesFhirR4.MedicationStatement,
                    sourceResourceId: id,
                    sourceVersionId: versionId,
                    twinSubjectId: target.twinSubjectId,
                    claims: researchClaims,
                  });
                  const registered = await this.blockchainAdapter.registerResearchVersionMappings(
                    [mapping],
                    resolveResearchDataChannel(job.sector, jurisdiction),
                    ClinicalEvidenceChaincode,
                  );
                  if (registered.accepted !== 1) {
                    throw new Error(`Research registration accepted ${registered.accepted}/1 resources.`);
                  }
                } catch (error) {
                  console.error('[ResearchLedger] Medication registration failed after private projection.', error);
                  terminologyWarning = createOperationOutcome(
                    IssueLevel.Warning,
                    IssueType.Processing,
                    'Research registration is temporarily unavailable.',
                  );
                }
              }
            }
          }

          responseEntries.push({
            type: 'MedicationStatement',
            response: {
              status: '201',
              location: `/${job.tenantId}/cds-${jurisdiction}/v1/${job.sector}/${normalizedSection}/${job.format}/MedicationStatement/_batch-response`,
              ...(terminologyWarning ? { outcome: terminologyWarning } : {}),
            },
            resource: { resourceType: ResourceTypesFhirR4.MedicationStatement, meta: { claims } },
          });
        } catch (e: any) {
          const status = e instanceof ManagerError ? e.status : '400';
          const code = e instanceof ManagerError ? e.code : IssueType.Invalid;
          responseEntries.push({
            type: 'MedicationStatement',
            resource: { resourceType: ResourceTypesFhirR4.OperationOutcome, meta: { claims: rawClaims || {} } },
            response: { status, outcome: createOperationOutcome(IssueLevel.Error, code, e?.message || 'Invalid entry') },
          });
        }
      }
    } else {
      const first = entries[0];
      const rawClaims = first?.resource?.meta?.claims ?? {};
      const claims = normalizeContextualizedClaims(rawClaims as Record<string, any>);
      const subject =
        getClaimValue<string>(claims, 'MedicationStatement.subject') ||
        getClaimValue<string>(claims, 'MedicationStatement.patient');
      if (!subject && scope !== SUBJECT_SECTION_DIGITAL_TWIN) {
        throw new ManagerError('Missing MedicationStatement.subject claim for search.', IssueType.Required);
      }

      const tenantVaultId = getTenantVaultId(job.sector, job.tenantId);
      const where = Object.entries(claims)
        .filter(([k, v]) => k !== '@context' && v !== undefined && v !== null && String(v).trim() !== '')
        .map(([name, value]) => ({ name, value: String(value).trim() }));
      let matches: any[];
      if (scope === SUBJECT_SECTION_DIGITAL_TWIN && !subject) {
        matches = await this.searchDigitalTwinMedications(tenantVaultId, claims);
      } else {
        const sectionId = getSubjectScopedSectionId(subject!, scope, 'medications');
        matches = await this.vaultRepository.query(tenantVaultId, { sectionId, where }, { hydrate: false });
      }
      responseEntries.push(...buildSearchResponseEntries(
        GatewayResponseEntryTypes.MedicationStatementSearch,
        matches,
      ));
    }

    return {
      jti: randomUUID(),
      type: 'org.hl7.fhir.api.Bundle',
      thid,
      iss: job.content?.aud as string,
      aud: job.content?.iss as string,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: {
        resourceType: 'Bundle',
        type: 'batch-response',
        data: responseEntries,
        total: responseEntries.length,
      },
    };
  }
}
