import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { createHash } from 'crypto';
import { FhirResourceTypeDataCollections, HealthcareConsentPurposes } from 'gdc-common-utils-ts/constants/index';
import { ClaimConsent } from 'gdc-common-utils-ts/models/consent-rule';
import { ServiceCapability } from 'gdc-common-utils-ts/constants/service-capabilities';
import type { RecordBase } from 'gdc-common-utils-ts/models/resource-document';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { SUBJECT_SECTION_DIGITAL_TWIN, SUBJECT_SECTION_INDIVIDUAL } from '../constants/domain';
import { getClaimValue } from './claims';
import {
  buildDigitalTwinSubjectAliasId,
  getOrCreateDigitalTwinSubjectId,
  isFinalizedDigitalTwinResearchRecord,
  isDigitalTwinResearchResourceType,
  isProfessionallyAttestedResearchRecord,
  markDigitalTwinStudyTargetShared,
  resolveAndProjectClaimsForDigitalTwin,
} from './digital-twin-research-projection';
import { getEnvSectionId } from './section-env';
import { getSubjectScopedSectionId } from './individual-sections';
import {
  buildResearchAssetVersionMapping,
  resolveResearchDataChannel,
  type ResearchAssetVersionMapping,
} from './research-asset-versioning';
import type { IBlockchainAdapter } from '../adapters/IBlockchainAdapter';
import type { OperationOutcome } from 'gdc-common-utils-ts/models/operation-outcome';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { createOperationOutcome } from './outcome';
import { ClinicalEvidenceChaincode } from './ledger';

const SECONDARY_USE_STATUS_SECTION = 'digitaltwin_secondary_use_status';

export type DigitalTwinSecondaryUseStatus = RecordBase & {
  type: 'digital-twin-secondary-use-status';
  sourceSubjectHash: string;
  status: 'enabled' | 'disabled';
  changedAt: string;
  /** One study/service owns one unlinkable twin. Absent only for legacy consent. */
  researchUseReference?: string;
};

export type EnabledDigitalTwinStudyTarget = Readonly<{
  researchUseReference?: string;
  twinSubjectId: string;
  changedAt: string;
  lastSharedAt?: string;
}>;

function subjectHash(subject: string): string {
  return createHash('sha256').update(String(subject || '').trim(), 'utf8').digest('hex');
}

function statusSectionId(): string {
  return getEnvSectionId(SECONDARY_USE_STATUS_SECTION);
}

function splitValues(value: unknown): string[] {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function isResearchSecondaryUseRule(claims: Record<string, any>): boolean {
  const purpose = String(getClaimValue(claims, ClaimConsent.purpose) || '').trim().toUpperCase();
  const actions = splitValues(getClaimValue(claims, ClaimConsent.action));
  return (purpose === HealthcareConsentPurposes.Research || purpose === 'RESEARCH') && actions.some((action) =>
    action === ServiceCapability.DigitalTwinReader || action === ServiceCapability.DigitalTwinProvider,
  );
}

function cleanStoredClaims(record: Record<string, any>): Record<string, any> {
  const claims = { ...record };
  delete claims.id;
  delete claims.indexed;
  delete claims.meta;
  delete claims.tag;
  return claims;
}

function projectedRecordId(resourceType: string, claims: Record<string, any>, sourceRecordId?: string): string {
  const identifier = String(
    getClaimValue(claims, `${resourceType}.identifier`)
    || getClaimValue(claims, `${resourceType}.identifier.value`)
    || '',
  ).trim();
  const seed = String(sourceRecordId || '').trim() || identifier || JSON.stringify(claims, Object.keys(claims).sort());
  return createHash('sha256').update(`${resourceType}|${seed}`, 'utf8').digest('hex');
}

async function clearSubjectProjection(
  vaultRepository: IVaultRepository,
  tenantVaultId: string,
  subject: string,
): Promise<void> {
  const suffix = `_${subjectHash(subject)}`;
  const prefix = getEnvSectionId(`${SUBJECT_SECTION_DIGITAL_TWIN}_`);
  const sectionIds = (await vaultRepository.getAllSections(tenantVaultId))
    .filter((sectionId) => String(sectionId || '').startsWith(prefix) && String(sectionId).endsWith(suffix));
  for (const sectionId of sectionIds) {
    const records = await vaultRepository.listContainersInSection<RecordBase>(tenantVaultId, sectionId);
    for (const record of records) {
      await vaultRepository.delete(tenantVaultId, String(record.id), sectionId);
    }
  }
}

async function rebuildProjection(
  vaultRepository: IVaultRepository,
  tenantVaultId: string,
  sourceSubject: string,
  sector: string,
  jurisdiction: string,
  researchUseReference?: string,
): Promise<Readonly<{
  researchMappings: ResearchAssetVersionMapping[];
  warnings: OperationOutcome[];
}>> {
  const researchMappings: ResearchAssetVersionMapping[] = [];
  const warnings: OperationOutcome[] = [];
  let projectedAny = false;
  const twinSubjectId = await getOrCreateDigitalTwinSubjectId({
    vaultRepository, tenantVaultId, sourceSubject, researchUseReference,
  });
  await clearSubjectProjection(vaultRepository, tenantVaultId, sourceSubject);
  await clearSubjectProjection(vaultRepository, tenantVaultId, twinSubjectId);

  const resourceCollections = Object.entries(FhirResourceTypeDataCollections) as Array<[string, string]>;
  for (const [resourceType, collectionId] of resourceCollections) {
    if (!isDigitalTwinResearchResourceType(resourceType)) continue;
    const sourceSectionId = getSubjectScopedSectionId(sourceSubject, SUBJECT_SECTION_INDIVIDUAL, collectionId);
    const sourceRecords = await vaultRepository.listContainersInSection<RecordBase>(tenantVaultId, sourceSectionId);
    for (const sourceRecord of sourceRecords) {
      const sourceClaims = cleanStoredClaims(sourceRecord as Record<string, any>);
      if (!isFinalizedDigitalTwinResearchRecord(resourceType, sourceClaims)) continue;
      if (!isProfessionallyAttestedResearchRecord(sourceClaims)) continue;
      const projection = await resolveAndProjectClaimsForDigitalTwin({
        claims: sourceClaims,
        resourceType,
        twinSubjectId,
        sector,
        jurisdiction,
      });
      if (projection.warning) warnings.push(projection.warning);
      const projectedClaims = projection.claims;
      if (researchUseReference) projectedClaims['__digitalTwinStudy.reference'] = researchUseReference;
      const targetSectionId = getSubjectScopedSectionId(twinSubjectId, SUBJECT_SECTION_DIGITAL_TWIN, collectionId);
      await vaultRepository.put(tenantVaultId, [{
        id: projectedRecordId(resourceType, projectedClaims, String(sourceRecord.id)),
        ...projectedClaims,
      }], targetSectionId);
      projectedAny = true;
      const sourceVersionId = String(
        (sourceRecord as Record<string, any>)?.indexed?.versionId
        || getClaimValue(sourceClaims, `${resourceType}.meta.versionId`)
        || '',
      ).trim();
      if (projection.researchReady && sourceVersionId) {
        researchMappings.push(buildResearchAssetVersionMapping({
          resourceType,
          sourceResourceId: String(sourceRecord.id),
          sourceVersionId,
          twinSubjectId,
          claims: projectedClaims,
        }));
      }
    }
  }

  const sourceCompositionSection = getSubjectScopedSectionId(sourceSubject, SUBJECT_SECTION_INDIVIDUAL, 'composition');
  const sourceCompositions = await vaultRepository.listContainersInSection<RecordBase>(tenantVaultId, sourceCompositionSection);
  const grouped = new Map<string, Record<string, any>>();
  for (const sourceRecord of sourceCompositions) {
    const claims = cleanStoredClaims(sourceRecord as Record<string, any>);
    if (!isFinalizedDigitalTwinResearchRecord(ResourceTypesFhirR4.Composition, claims)) continue;
    if (!isProfessionallyAttestedResearchRecord(claims)) continue;
    const identifier = String(getClaimValue(claims, 'Composition.identifier') || sourceRecord.id).trim();
    const previous = grouped.get(identifier);
    const sections = new Set([
      ...splitValues(previous && getClaimValue(previous, 'Composition.section')),
      ...splitValues(getClaimValue(claims, 'Composition.section')),
    ]);
    grouped.set(identifier, { ...(previous || {}), ...claims, 'Composition.section': Array.from(sections).join(',') });
  }
  const targetCompositionSection = getSubjectScopedSectionId(twinSubjectId, SUBJECT_SECTION_DIGITAL_TWIN, 'composition');
  for (const claims of grouped.values()) {
    const { claims: projectedClaims } = await resolveAndProjectClaimsForDigitalTwin({
      claims,
      resourceType: ResourceTypesFhirR4.Composition,
      twinSubjectId,
      sector,
      jurisdiction,
    });
    if (researchUseReference) projectedClaims['__digitalTwinStudy.reference'] = researchUseReference;
    await vaultRepository.put(tenantVaultId, [{
      id: projectedRecordId('Composition', projectedClaims),
      ...projectedClaims,
    }], targetCompositionSection);
    projectedAny = true;
  }
  if (projectedAny) {
    await markDigitalTwinStudyTargetShared({
      vaultRepository,
      tenantVaultId,
      sourceSubject,
      researchUseReference,
    });
  }
  return { researchMappings, warnings };
}

/** Returns true only after at least one explicit secondary-use permit. */
export async function isDigitalTwinSecondaryUseEnabled(input: {
  vaultRepository: IVaultRepository;
  tenantVaultId: string;
  sourceSubject: string;
  researchUseReference?: string;
}): Promise<boolean> {
  const researchUseReference = String(input.researchUseReference || '').trim();
  if (researchUseReference) {
    const status = await input.vaultRepository.get<DigitalTwinSecondaryUseStatus>(
      input.tenantVaultId,
      buildDigitalTwinSubjectAliasId(input.sourceSubject, researchUseReference),
      statusSectionId(),
    );
    return status?.status === 'enabled';
  }
  return (await input.vaultRepository.listContainersInSection<DigitalTwinSecondaryUseStatus>(
    input.tenantVaultId,
    statusSectionId(),
  )).some((status) => status.sourceSubjectHash === subjectHash(input.sourceSubject) && status.status === 'enabled');
}

/** Returns every enabled study-specific target for one operational subject. */
export async function listEnabledDigitalTwinStudyTargets(input: {
  vaultRepository: IVaultRepository;
  tenantVaultId: string;
  sourceSubject: string;
}): Promise<EnabledDigitalTwinStudyTarget[]> {
  const sourceHash = subjectHash(input.sourceSubject);
  const statuses = await input.vaultRepository.listContainersInSection<DigitalTwinSecondaryUseStatus>(
    input.tenantVaultId,
    statusSectionId(),
  );
  const enabled = statuses.filter((status) => status.sourceSubjectHash === sourceHash && status.status === 'enabled');
  const targets: EnabledDigitalTwinStudyTarget[] = [];
  for (const status of enabled) {
    const researchUseReference = String(status.researchUseReference || '').trim();
    const twinSubjectId = await getOrCreateDigitalTwinSubjectId({
      vaultRepository: input.vaultRepository,
      tenantVaultId: input.tenantVaultId,
      sourceSubject: input.sourceSubject,
      ...(researchUseReference ? { researchUseReference } : {}),
    });
    const alias = await input.vaultRepository.get<any>(
      input.tenantVaultId,
      buildDigitalTwinSubjectAliasId(input.sourceSubject, researchUseReference),
      getEnvSectionId('digitaltwin_subject_aliases'),
    );
    const lastSharedAt = String(alias?.lastSharedAt || '').trim();
    targets.push({
      ...(researchUseReference ? { researchUseReference } : {}),
      twinSubjectId,
      changedAt: status.changedAt,
      ...(lastSharedAt ? { lastSharedAt } : {}),
    });
  }
  return targets.sort((left, right) => String(left.researchUseReference || '').localeCompare(String(right.researchUseReference || '')));
}

/**
 * Applies one subject-level research-use decision.
 *
 * A denial pauses future synchronization while preserving both the stable
 * alias and the already lawfully published anonymous twin. A later permit
 * rebuilds that same twin from the current operational records. This is a
 * reversible disable, not provider offboarding and not a purge.
 */
export async function applyDigitalTwinSecondaryUseDecision(input: {
  vaultRepository: IVaultRepository;
  tenantVaultId: string;
  claims: Record<string, any>;
  sector?: string;
  jurisdiction?: string;
  blockchainAdapter?: IBlockchainAdapter;
  warnings?: OperationOutcome[];
}): Promise<boolean> {
  if (!isResearchSecondaryUseRule(input.claims)) return false;
  const sourceSubject = String(getClaimValue(input.claims, ClaimConsent.subject) || '').trim();
  const decision = String(getClaimValue(input.claims, ClaimConsent.decision) || '').trim().toLowerCase();
  if (!sourceSubject || (decision !== 'permit' && decision !== 'deny')) return false;

  const currentReference = String(
    getClaimValue(input.claims, ClaimConsent.sourceReference)
    || getClaimValue(input.claims, ClaimConsent.identifier)
    || '',
  ).trim();
  const enabled = decision === 'permit';
  const status: DigitalTwinSecondaryUseStatus = {
    id: buildDigitalTwinSubjectAliasId(sourceSubject, currentReference),
    type: 'digital-twin-secondary-use-status',
    sourceSubjectHash: subjectHash(sourceSubject),
    status: enabled ? 'enabled' : 'disabled',
    changedAt: new Date().toISOString(),
    ...(currentReference ? { researchUseReference: currentReference } : {}),
  };
  await input.vaultRepository.put(input.tenantVaultId, [status], statusSectionId());

  if (enabled) {
    const projection = await rebuildProjection(
      input.vaultRepository,
      input.tenantVaultId,
      sourceSubject,
      String(input.sector || input.tenantVaultId.split('_')[0] || ''),
      String(input.jurisdiction || ''),
      currentReference || undefined,
    );
    input.warnings?.push(...projection.warnings);
    if (projection.researchMappings.length > 0 && input.blockchainAdapter?.registerResearchVersionMappings) {
      try {
        const submitted = await input.blockchainAdapter.registerResearchVersionMappings(
          projection.researchMappings,
          resolveResearchDataChannel(input.sector, input.jurisdiction),
          ClinicalEvidenceChaincode,
        );
        if (submitted.accepted !== projection.researchMappings.length) {
          throw new Error(`Research registration accepted ${submitted.accepted}/${projection.researchMappings.length} resources.`);
        }
      } catch (error) {
        console.error('[ResearchLedger] Consent rebuild registration failed after private projection.', error);
        input.warnings?.push(createOperationOutcome(
          IssueLevel.Warning,
          IssueType.Processing,
          'Research registration is temporarily unavailable.',
        ));
      }
    }
  }
  return true;
}

/**
 * Provider offboarding irreversibly destroys only the tenant-private
 * individual-to-twin binding (account deletion or index-provider migration).
 *
 * The already projected twin remains searchable as anonymous, immutable
 * research data. Synchronization is disabled first. A later permit creates a
 * new UUID URN and cannot reconnect the old anonymous twin to the individual.
 */
export async function purgeDigitalTwinSubjectLink(input: {
  vaultRepository: IVaultRepository;
  tenantVaultId: string;
  sourceSubject: string;
}): Promise<{ purged: boolean; detachedTwinSubjectId?: string; detachedTwinSubjectIds?: string[] }> {
  const sourceSubject = String(input.sourceSubject || '').trim();
  if (!sourceSubject) throw new Error('sourceSubject is required');
  const aliasSectionId = getEnvSectionId('digitaltwin_subject_aliases');
  const sourceHash = subjectHash(sourceSubject);
  const registeredAliases = typeof input.vaultRepository.getContainersInSection === 'function'
    ? await input.vaultRepository.getContainersInSection<any>(input.tenantVaultId, aliasSectionId)
    : await input.vaultRepository.listContainersInSection<any>(input.tenantVaultId, aliasSectionId);
  const aliases = registeredAliases
    .filter((alias) => alias?.sourceSubjectHash === sourceHash || alias?.id === sourceHash);
  if (aliases.length === 0) {
    const legacyAlias = await input.vaultRepository.get<any>(input.tenantVaultId, sourceHash, aliasSectionId);
    if (legacyAlias?.twinSubjectId) aliases.push({ ...legacyAlias, id: legacyAlias.id || sourceHash });
  }
  const statuses = (await input.vaultRepository.listContainersInSection<DigitalTwinSecondaryUseStatus>(
    input.tenantVaultId,
    statusSectionId(),
  )).filter((status) => status.sourceSubjectHash === sourceHash || status.id === sourceHash);
  if (statuses.length === 0) statuses.push({
    id: sourceHash,
    type: 'digital-twin-secondary-use-status',
    sourceSubjectHash: sourceHash,
    status: 'disabled',
    changedAt: new Date().toISOString(),
  });
  for (const status of statuses) {
    await input.vaultRepository.put(input.tenantVaultId, [{
      ...status,
      status: 'disabled',
      changedAt: new Date().toISOString(),
    }], statusSectionId());
  }
  const detachedTwinSubjectIds = aliases
    .map((alias) => String(alias?.twinSubjectId || '').trim())
    .filter(Boolean);
  for (const alias of aliases) await input.vaultRepository.delete(input.tenantVaultId, String(alias.id), aliasSectionId);
  if (detachedTwinSubjectIds.length === 0) return { purged: false };
  return {
    purged: true,
    detachedTwinSubjectId: detachedTwinSubjectIds[0],
    ...(detachedTwinSubjectIds.length > 1 ? { detachedTwinSubjectIds } : {}),
  };
}
