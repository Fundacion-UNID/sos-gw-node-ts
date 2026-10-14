import { randomUUID } from 'node:crypto';
import { normalizeUuid } from 'gdc-common-utils-ts';
import { HealthcareConsentPurposes } from 'gdc-common-utils-ts/constants/healthcare';
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { ClaimConsent, ConsentDecisions, ConsentStatuses } from 'gdc-common-utils-ts/models/consent-rule';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import type { ClinicalCreatorBinding } from 'gdc-common-utils-ts/utils/fhir-ips-creator-identity';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { getClinicalCreatorBindingsSectionId } from '../utils/clinical-creator-binding';
import { createOperationOutcome } from '../utils/outcome';
import { getTenantVaultId } from '../utils/tenant';
import {
  buildClaimsOnlyResource,
  claimsOnlyContent,
  flatClaimsEqual,
  flatClaimsToIndexedAttributes,
  normalizeGovernedFlatClaims,
  readClaimsOnlyContent,
  requireClaimsOnlyResourceShape,
  type FlatClaims,
} from '../utils/fhir-flat-claims';
import { normalizeCodeSystemAndValue } from '../utils/normalize-codeAndSystem';
import { parseProfessionalDidIdentity } from '../utils/professional-did-identity';
import { hasActiveProfessionalIdentityAndLicense } from '../utils/professional-license';
import type { IJobProcessor } from './registry';
import { buildGroupMemberProjectionId, buildGroupMemberSectionId } from './GroupManager';
import {
  buildResearchStudyPartyProjectionId,
  buildResearchStudyPartySectionId,
} from './ResearchStudyManager';

export const RESEARCH_STUDY_CONSENT_SECTION = 'research-study-consents';
export const ORGANIZATION_WORKFLOW_CONSENT_SECTION = 'organization-workflow-consents';
export const RESEARCH_STUDY_SECTION = 'research-studies';
const GROUP_SECTION = 'research-groups';
const ROUTE_SECTION = 'organization';
const FHIR_R5_FORMAT = 'org.hl7.fhir.r5';

type TenantRegistry = {
  tenantExists(vaultId: string): Promise<boolean>;
  getCollectionName(vaultId: string): Promise<string | undefined>;
  getTenantJurisdiction(vaultId: string): Promise<string | undefined>;
  getDidDocument(vaultId: string): Promise<{ controller?: unknown } | undefined>;
};

type ConsentEntry = {
  type?: string;
  request?: { method?: string; url?: string };
  resource?: Record<string, any>;
};

const RESEARCH_CONSENT_CLAIMS = new Set<string>([
  ClaimConsent.status,
  ClaimConsent.decision,
  ClaimConsent.purpose,
  ClaimConsent.sourceReference,
  ClaimConsent.actorIdentifier,
  ClaimConsent.actorRole,
  ClaimConsent.action,
  ClaimConsent.date,
]);
const WORKFLOW_CONSENT_CLAIMS = new Set<string>([
  ...RESEARCH_CONSENT_CLAIMS,
  ClaimConsent.subject,
  ClaimConsent.grantor,
  ClaimConsent.grantee,
  ClaimConsent.manager,
  ClaimConsent.controller,
  ClaimConsent.identifier,
]);
const CONSENT_CLAIMS = WORKFLOW_CONSENT_CLAIMS;
const ENCOUNTER_WORKFLOW_ACTION = 'organization/Encounter.cruds,organization/EncounterHistory.cruds';
const SCHEDULING_WORKFLOW_ACTION = 'organization/Appointment.cruds,organization/Schedule.cruds,organization/Slot.cruds';
export const SUBJECT_COMPOSITION_CONTRIBUTION_ACTION = 'Subject/Composition.cuds';

export type ResearchStudyConsentRecord = Readonly<{ claims: FlatClaims }>;

export interface ResearchStudyConsentManagerDeps {
  vaultRepository: IVaultRepository;
  kmsService: IKmsService;
  tenantManager: TenantRegistry;
}

/**
 * Activates controller-selected ResearchStudy reviewer and organization
 * workflow permissions.
 *
 * A Communication may carry the same Consent as `draft`, but this manager
 * rejects it. Authorization starts only here, after the current tenant
 * controller explicitly submits `active` and the correlated PractitionerRole
 * has a DCR-bound clinical creator assignment and an exact claims-only
 * associated-party projection for this study. The projection remains
 * descriptive: it is a mandatory eligibility check, never the grant itself.
 * Group membership is never consulted as a grant. Deterministic POST replay is
 * idempotent, PATCH with only `Consent.status=inactive` revokes the stored
 * decision, and controller-only search exposes lifecycle state without minting
 * a SMART token.
 *
 * The only admitted SMART action is
 * `organization/ResearchSubject.crus?study=ResearchStudy/<id>`; whole-twin
 * delete is deliberately absent.
 *
 * @see https://hl7.org/fhir/R5/consent.html
 * @see https://hl7.org/fhir/R5/researchstudy.html
 */
export class ResearchStudyConsentManager implements IJobProcessor {
  constructor(private readonly deps: ResearchStudyConsentManagerDeps) {}

  async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    this.validateRoute(job);
    const { vaultId, collectionName } = await this.resolveTenant(job);
    await this.requireController(job, vaultId);
    if (job.action === '_search') return this.search(job, vaultId, collectionName);
    const entries = readEntries(job);
    if (entries.length === 0) {
      throw new ManagerError('ResearchStudy Consent _batch requires at least one entry.', IssueType.Required);
    }

    const results = [];
    for (const entry of entries) {
      try {
        results.push(await this.writeEntry(entry, vaultId, collectionName, String(job.tenantId)));
      } catch (error) {
        results.push(errorEntry(entry, error));
      }
    }
    return response(job, 'batch-response', results);
  }

  private validateRoute(job: JobRequest): void {
    if (!job.content?.thid) throw new ManagerError('Missing thid.', IssueType.Required);
    if (!job.tenantId || !job.sector || !job.jurisdiction) {
      throw new ManagerError('ResearchStudy Consent requires tenantId, sector and jurisdiction.', IssueType.Required);
    }
    if (String(job.section || '').toLowerCase() !== ROUTE_SECTION
      || String(job.format || '').toLowerCase() !== FHIR_R5_FORMAT
      || (job.action !== '_batch' && job.action !== '_search')) {
      throw new ManagerError('ResearchStudy Consent requires organization/org.hl7.fhir.r5/Consent/_batch or Consent/_search.', IssueType.NotSupported);
    }
  }

  private async writeEntry(entry: ConsentEntry, vaultId: string, collectionName: string, tenantId: string) {
    const method = String(entry.request?.method || '').toUpperCase();
    if (method === 'POST') return this.activate(entry, vaultId, collectionName, tenantId);
    if (method === 'PATCH') return this.revoke(entry, vaultId, collectionName);
    throw new ManagerError('ResearchStudy Consent accepts POST activation or PATCH revocation only.', IssueType.NotSupported);
  }

  private async resolveTenant(job: JobRequest): Promise<{ vaultId: string; collectionName: string }> {
    const vaultId = getTenantVaultId(String(job.sector), String(job.tenantId));
    if (!(await this.deps.tenantManager.tenantExists(vaultId))) {
      throw new ManagerError('ResearchStudy Consent tenant was not found.', IssueType.NotFound);
    }
    const expected = String(await this.deps.tenantManager.getTenantJurisdiction(vaultId) || '').trim();
    if (!expected || expected.toUpperCase() !== String(job.jurisdiction).trim().toUpperCase()) {
      throw new ManagerError('ResearchStudy Consent route jurisdiction does not match the tenant jurisdiction.', IssueType.Forbidden);
    }
    const collectionName = String(await this.deps.tenantManager.getCollectionName(vaultId) || '').trim();
    if (!collectionName) throw new ManagerError('ResearchStudy Consent tenant storage is unavailable.', IssueType.NotFound);
    return { vaultId, collectionName };
  }

  private async requireController(job: JobRequest, vaultId: string): Promise<void> {
    const issuer = String(job.content?.iss || '').trim();
    const didDocument = await this.deps.tenantManager.getDidDocument(vaultId);
    const controllers = normalizeReferences(didDocument?.controller);
    if (!issuer || !controllers.includes(issuer)) {
      throw new ManagerError('ResearchStudy Consent activation requires a current tenant controller.', IssueType.Forbidden);
    }
  }

  private async activate(
    entry: ConsentEntry,
    vaultId: string,
    collectionName: string,
    tenantId: string,
  ): Promise<Record<string, unknown>> {
    requireClaimsOnlyResourceShape(entry.resource, 'Consent', 'ResearchStudy Consent');
    const id = boundedId(entry.resource.id);
    const claims = normalizeGovernedFlatClaims(entry.resource.meta.claims, CONSENT_CLAIMS, 'Organization Consent');
    if (singleClaim(claims, ClaimConsent.status) !== ConsentStatuses.Active) {
      throw new ManagerError('Only an active Consent can authorize ResearchStudy work.', IssueType.Invalid);
    }
    if (singleClaim(claims, ClaimConsent.decision) !== ConsentDecisions.Permit) {
      throw new ManagerError('ResearchStudy Consent must carry the explicit permit decision.', IssueType.Invalid);
    }
    const purpose = singleClaim(claims, ClaimConsent.purpose);
    if (purpose === HealthcareConsentPurposes.Operations) {
      return this.activateWorkflowConsent(id, claims, vaultId, collectionName, tenantId);
    }
    if (purpose !== HealthcareConsentPurposes.Research) {
      throw new ManagerError('Organization Consent must use a governed research or operations purpose.', IssueType.Invalid);
    }
    requireOnlyClaims(claims, RESEARCH_CONSENT_CLAIMS, 'ResearchStudy Consent');

    const studyReference = canonicalReference(
      singleClaim(claims, ClaimConsent.sourceReference),
      'ResearchStudy',
    );
    const practitionerRoleReference = canonicalReference(
      singleClaim(claims, ClaimConsent.actorIdentifier),
      'PractitionerRole',
    );
    const actorRole = normalizeCodeSystemAndValue(singleClaim(claims, ClaimConsent.actorRole));
    if (!actorRole) throw new ManagerError('ResearchStudy Consent requires one actor role.', IssueType.Required);
    const action = singleClaim(claims, ClaimConsent.action);
    const expectedAction = buildResearchStudyAccessScope(studyReference);
    if (action !== expectedAction) {
      throw new ManagerError(`ResearchStudy Consent action must be '${expectedAction}' and must not include delete.`, IssueType.Invalid);
    }

    const existing = await this.deps.vaultRepository.get<ConfidentialStorageDoc>(
      collectionName,
      id,
      RESEARCH_STUDY_CONSENT_SECTION,
    );
    if (existing) {
      const existingClaims = readClaimsOnlyContent(
        await this.deps.kmsService.unprotectConfidentialData<unknown>(existing, vaultId),
      );
      if (!existingClaims) {
        throw new ManagerError('Historical native ResearchStudy Consent requires an explicit recoverable migration.', IssueType.Invalid);
      }
      if (flatClaimsEqual(existingClaims, claims)) {
        return successEntry(id, claims, HttpStatusCodes.Ok);
      }
      throw new ManagerError(`ResearchStudy Consent already exists with different claims: ${id}.`, IssueType.Conflict);
    }

    const studyId = studyReference.slice('ResearchStudy/'.length);
    const studyDocument = await this.deps.vaultRepository.get<ConfidentialStorageDoc>(
      collectionName,
      studyId,
      RESEARCH_STUDY_SECTION,
    );
    if (!studyDocument) throw new ManagerError('The correlated ResearchStudy was not found.', IssueType.NotFound);
    const study = await this.deps.kmsService.unprotectConfidentialData<unknown>(studyDocument, vaultId);
    if (!readClaimsOnlyContent(study)) {
      throw new ManagerError('The correlated ResearchStudy is not stored as canonical flat claims.', IssueType.Invalid);
    }
    const partyDocument = await this.deps.vaultRepository.get<ConfidentialStorageDoc>(
      collectionName,
      buildResearchStudyPartyProjectionId(studyId, practitionerRoleReference),
      buildResearchStudyPartySectionId(studyId),
    );
    const partyClaims = partyDocument
      ? readClaimsOnlyContent(await this.deps.kmsService.unprotectConfidentialData<unknown>(partyDocument, vaultId))
      : undefined;
    if (partyClaims?.['ResearchStudy.party']?.[0] !== practitionerRoleReference) {
      throw new ManagerError('The PractitionerRole is not an associated party of this ResearchStudy.', IssueType.Forbidden);
    }

    await this.requireActiveProfessional(practitionerRoleReference, actorRole, vaultId, collectionName, 'ResearchStudy Consent');

    await this.persist(id, claims, 0, vaultId, collectionName);
    return successEntry(id, claims, HttpStatusCodes.Created);
  }

  private async activateWorkflowConsent(
    id: string,
    claims: FlatClaims,
    vaultId: string,
    collectionName: string,
    tenantId: string,
  ): Promise<Record<string, unknown>> {
    requireOnlyClaims(claims, WORKFLOW_CONSENT_CLAIMS, 'Organization workflow Consent');
    const organizationReference = canonicalReference(
      singleClaim(claims, ClaimConsent.subject),
      'Organization',
    );
    if (organizationReference !== `Organization/${boundedId(tenantId)}`) {
      throw new ManagerError('Organization workflow Consent subject must match the routed tenant.', IssueType.Forbidden);
    }
    for (const claim of [ClaimConsent.grantor, ClaimConsent.manager, ClaimConsent.controller]) {
      if (singleClaim(claims, claim) !== organizationReference) {
        throw new ManagerError(`Organization workflow Consent '${claim}' must match its subject.`, IssueType.Invalid);
      }
    }
    const groupReference = canonicalReference(singleClaim(claims, ClaimConsent.sourceReference), 'Group');
    const practitionerRoleReference = canonicalReference(
      singleClaim(claims, ClaimConsent.actorIdentifier),
      'PractitionerRole',
    );
    if (singleClaim(claims, ClaimConsent.grantee) !== practitionerRoleReference) {
      throw new ManagerError('Organization workflow Consent grantee must match its actor.', IssueType.Invalid);
    }
    if (singleClaim(claims, ClaimConsent.identifier) !== `urn:uuid:${id}`) {
      throw new ManagerError('Organization workflow Consent identifier must match its resource id.', IssueType.Invalid);
    }
    const actorRole = normalizeCodeSystemAndValue(singleClaim(claims, ClaimConsent.actorRole));
    if (!actorRole) throw new ManagerError('Organization workflow Consent requires one actor role.', IssueType.Required);
    const action = singleClaim(claims, ClaimConsent.action);
    if (action !== ENCOUNTER_WORKFLOW_ACTION
      && action !== SCHEDULING_WORKFLOW_ACTION
      && action !== SUBJECT_COMPOSITION_CONTRIBUTION_ACTION
      && !isOrganizationSubjectRegistrationAction(action, organizationReference)) {
      throw new ManagerError('Organization workflow Consent contains an unsupported capability set.', IssueType.Invalid);
    }

    const existing = await this.deps.vaultRepository.get<ConfidentialStorageDoc>(
      collectionName,
      id,
      ORGANIZATION_WORKFLOW_CONSENT_SECTION,
    );
    if (existing) {
      const existingClaims = readClaimsOnlyContent(
        await this.deps.kmsService.unprotectConfidentialData<unknown>(existing, vaultId),
      );
      if (!existingClaims) {
        throw new ManagerError('Historical native organization workflow Consent requires an explicit recoverable migration.', IssueType.Invalid);
      }
      if (flatClaimsEqual(existingClaims, claims)) return successEntry(id, claims, HttpStatusCodes.Ok);
      throw new ManagerError(`Organization workflow Consent already exists with different claims: ${id}.`, IssueType.Conflict);
    }

    const groupId = groupReference.slice('Group/'.length);
    const groupDocument = await this.deps.vaultRepository.get<ConfidentialStorageDoc>(collectionName, groupId, GROUP_SECTION);
    const groupClaims = groupDocument
      ? readClaimsOnlyContent(await this.deps.kmsService.unprotectConfidentialData<unknown>(groupDocument, vaultId))
      : undefined;
    if (!groupClaims
      || groupClaims['Group.type']?.[0] !== 'practitioner'
      || groupClaims['Group.membership']?.[0] !== 'enumerated'
      || groupClaims['Group.managing-entity']?.[0] !== organizationReference) {
      throw new ManagerError('The governed practitioner Group was not found for this organization.', IssueType.Forbidden);
    }
    const memberDocument = await this.deps.vaultRepository.get<ConfidentialStorageDoc>(
      collectionName,
      buildGroupMemberProjectionId(groupId, practitionerRoleReference),
      buildGroupMemberSectionId(groupId),
    );
    const memberClaims = memberDocument
      ? readClaimsOnlyContent(await this.deps.kmsService.unprotectConfidentialData<unknown>(memberDocument, vaultId))
      : undefined;
    if (memberClaims?.['Group.member']?.[0] !== practitionerRoleReference) {
      throw new ManagerError('The PractitionerRole is not a member of the governed workflow Group.', IssueType.Forbidden);
    }

    await this.requireActiveProfessional(practitionerRoleReference, actorRole, vaultId, collectionName, 'Organization workflow Consent');
    await this.persist(id, claims, 0, vaultId, collectionName, ORGANIZATION_WORKFLOW_CONSENT_SECTION);
    return successEntry(id, claims, HttpStatusCodes.Created);
  }

  private async requireActiveProfessional(
    practitionerRoleReference: string,
    actorRole: string,
    vaultId: string,
    collectionName: string,
    label: string,
  ): Promise<void> {
    const bindings = await this.deps.vaultRepository.listContainersInSection<any>(
      vaultId,
      getClinicalCreatorBindingsSectionId(),
    );
    const binding = bindings.find((candidate) =>
      isClinicalCreatorBinding(candidate)
      && canonicalPractitionerRoleFromAuthor(candidate.authorIdentifier) === practitionerRoleReference);
    if (!binding || !Array.isArray(binding.dcrClientIds) || binding.dcrClientIds.length === 0) {
      throw new ManagerError(`The PractitionerRole must complete DCR before ${label} activation.`, IssueType.Forbidden);
    }
    if (normalizeCodeSystemAndValue(binding.role) !== actorRole) {
      throw new ManagerError(`${label} actor role does not match the authoritative PractitionerRole binding.`, IssueType.Forbidden);
    }
    const professionalIdentity = ((binding as ClinicalCreatorBinding & { actorDids?: readonly string[] }).actorDids || [])
      .map((did: string) => parseProfessionalDidIdentity(did))
      .find((identity: ReturnType<typeof parseProfessionalDidIdentity>) =>
        identity && normalizeCodeSystemAndValue(identity.role) === actorRole);
    if (!professionalIdentity || !(await hasActiveProfessionalIdentityAndLicense({
      tenantVaultId: vaultId,
      employeeCollectionName: collectionName,
      identity: professionalIdentity,
      vaultRepository: this.deps.vaultRepository,
      kmsService: this.deps.kmsService,
    }))) {
      throw new ManagerError(`${label} requires an active Employee identity and applicable licence.`, IssueType.Forbidden);
    }
  }

  private async revoke(entry: ConsentEntry, vaultId: string, collectionName: string) {
    requireClaimsOnlyResourceShape(entry.resource, 'Consent', 'ResearchStudy Consent revocation');
    const id = boundedId(entry.resource?.id);
    requireMatchingRequestId(entry, id);
    const patch = normalizeGovernedFlatClaims(entry.resource?.meta?.claims, CONSENT_CLAIMS, 'ResearchStudy Consent revocation');
    if (Object.keys(patch).length !== 1 || singleClaim(patch, ClaimConsent.status) !== ConsentStatuses.Inactive) {
      throw new ManagerError('ResearchStudy Consent revocation PATCH accepts only Consent.status=inactive.', IssueType.Invalid);
    }
    let section = RESEARCH_STUDY_CONSENT_SECTION;
    let current = await this.deps.vaultRepository.get<ConfidentialStorageDoc>(
      collectionName,
      id,
      section,
    );
    if (!current) {
      section = ORGANIZATION_WORKFLOW_CONSENT_SECTION;
      current = await this.deps.vaultRepository.get<ConfidentialStorageDoc>(collectionName, id, section);
    }
    if (!current) throw new ManagerError(`Organization Consent not found: ${id}.`, IssueType.NotFound);
    const currentClaims = readClaimsOnlyContent(
      await this.deps.kmsService.unprotectConfidentialData<unknown>(current, vaultId),
    );
    if (!currentClaims) {
      throw new ManagerError('Historical native ResearchStudy Consent requires an explicit recoverable migration.', IssueType.Invalid);
    }
    const claims = normalizeGovernedFlatClaims(
      { ...currentClaims, [ClaimConsent.status]: ConsentStatuses.Inactive },
      CONSENT_CLAIMS,
      'ResearchStudy Consent revocation',
    );
    await this.persist(id, claims, Number(current.sequence ?? 0) + 1, vaultId, collectionName, section);
    return successEntry(id, claims, HttpStatusCodes.Ok);
  }

  private async persist(
    id: string,
    claims: FlatClaims,
    sequence: number,
    vaultId: string,
    collectionName: string,
    section = RESEARCH_STUDY_CONSENT_SECTION,
  ): Promise<void> {
    const protectedAttributes = await this.deps.kmsService.protectAttributesNameAndValue(
      flatClaimsToIndexedAttributes(claims, CONSENT_CLAIMS) as any,
      vaultId,
    );
    const document: ConfidentialStorageDoc = {
      id,
      status: 'active' as any,
      sequence,
      content: claimsOnlyContent(claims),
      indexed: { attributes: protectedAttributes },
      audit: { updated: new Date().toISOString() } as any,
    };
    const encrypted = await this.deps.kmsService.protectConfidentialData(document, vaultId);
    if (!(await this.deps.vaultRepository.put(collectionName, [encrypted], section))) {
      throw new ManagerError('ResearchStudy Consent could not be persisted.', IssueType.NoStore);
    }
  }

  private async search(job: JobRequest, vaultId: string, collectionName: string) {
    const filters = readSearchFilters(job);
    const protectedValues = await this.deps.kmsService.protectAttributesNameAndValue(
      [...filters].flatMap(([name, values]) => values.map((value) => ({ name, value }))) as any,
      vaultId,
    );
    const protectedFilters = groupProtectedFilters(filters, protectedValues);
    const records = (await Promise.all([
      this.deps.vaultRepository.listContainersInSection<ConfidentialStorageDoc>(
        collectionName,
        RESEARCH_STUDY_CONSENT_SECTION,
      ),
      this.deps.vaultRepository.listContainersInSection<ConfidentialStorageDoc>(
        collectionName,
        ORGANIZATION_WORKFLOW_CONSENT_SECTION,
      ),
    ])).flat();
    const data: Record<string, unknown>[] = [];
    for (const record of records) {
      if (!matchesProtectedAttributes(record, protectedFilters)) continue;
      const claims = readClaimsOnlyContent(
        await this.deps.kmsService.unprotectConfidentialData<unknown>(record, vaultId),
      );
      if (!claims) {
        throw new ManagerError('Historical native ResearchStudy Consent requires an explicit recoverable migration.', IssueType.Invalid);
      }
      data.push(successEntry(record.id, claims, HttpStatusCodes.Ok, 'Consent-search-response-v5.0.0'));
    }
    return response(job, 'searchset', data);
  }
}

function isOrganizationSubjectRegistrationAction(action: string, organizationReference: string): boolean {
  return action === `organization/Subject.c?organization=${organizationReference}`;
}

export function buildResearchStudyAccessScope(studyReference: string): string {
  return `organization/ResearchSubject.crus?study=${studyReference}`;
}

/**
 * Builds the least-privilege SMART scope used when the current organization
 * controller imports new rows into one existing study. Reading, updating and
 * deleting ResearchSubjects are deliberately absent. This resource-and-filter
 * pattern can later be reused by independent Appointment policies, but this
 * helper grants no appointment capability.
 */
export function buildResearchStudyControllerImportScope(studyReference: string): string {
  return `organization/ResearchSubject.c?study=${studyReference}`;
}

export function canonicalPractitionerRoleFromAuthor(value: string): string | undefined {
  const normalized = normalizeUuid(value);
  if (!normalized) return undefined;
  return `PractitionerRole/${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20)}`;
}

function canonicalReference(
  value: string,
  resourceType: 'ResearchStudy' | 'PractitionerRole' | 'Organization' | 'Group',
): string {
  const normalized = value.trim();
  if (!normalized.startsWith(`${resourceType}/`)) {
    throw new ManagerError(`ResearchStudy Consent requires a ${resourceType} reference.`, IssueType.Invalid);
  }
  const id = boundedId(normalized.slice(resourceType.length + 1));
  return `${resourceType}/${id}`;
}

function requireOnlyClaims(claims: FlatClaims, allowed: ReadonlySet<string>, label: string): void {
  const unsupported = Object.keys(claims).find((name) => !allowed.has(name));
  if (unsupported) throw new ManagerError(`Unsupported ${label} claim '${unsupported}'.`, IssueType.Invalid);
}

function boundedId(value: unknown): string {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9\-.]{1,64}$/.test(id)) {
    throw new ManagerError('ResearchStudy Consent resource reference is missing or invalid.', IssueType.Value);
  }
  return id;
}

function singleClaim(claims: FlatClaims, name: string): string {
  const values = claims[name];
  if (values?.length !== 1) {
    throw new ManagerError(`ResearchStudy Consent requires exactly one '${name}' value.`, IssueType.Invalid);
  }
  return values[0];
}

function normalizeReferences(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map((item) => typeof item === 'string' ? item.trim() : String((item as any)?.id || '').trim()).filter(Boolean);
}

function isClinicalCreatorBinding(value: unknown): value is ClinicalCreatorBinding {
  if (!value || typeof value !== 'object') return false;
  const binding = value as Partial<ClinicalCreatorBinding>;
  return binding.kind === 'professional'
    && typeof binding.actorIdentifier === 'string'
    && typeof binding.authorIdentifier === 'string'
    && typeof binding.role === 'string';
}

function readEntries(job: JobRequest): ConsentEntry[] {
  const body = job.content?.body as any;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.entry)) return body.entry;
  return [];
}

function readSearchFilters(job: JobRequest): Map<string, readonly string[]> {
  const raw = readEntries(job)[0]?.resource?.meta?.claims || {};
  return new Map(Object.entries(normalizeGovernedFlatClaims(raw, CONSENT_CLAIMS, 'ResearchStudy Consent search')));
}

function requireMatchingRequestId(entry: ConsentEntry, id: string): void {
  if (String(entry.request?.url || '').replace(/^Consent\//, '').trim() !== id) {
    throw new ManagerError('ResearchStudy Consent id does not match request.url.', IssueType.Conflict);
  }
}

function groupProtectedFilters(
  source: Map<string, readonly string[]>,
  protectedValues: readonly { name: string; value: string }[],
): Map<string, readonly { name: string; value: string }[]> {
  let offset = 0;
  return new Map([...source].map(([name, values]) => {
    const group = protectedValues.slice(offset, offset + values.length);
    offset += values.length;
    return [name, group];
  }));
}

function matchesProtectedAttributes(
  record: ConfidentialStorageDoc,
  filters: Map<string, readonly { name: string; value: string }[]>,
): boolean {
  const attributes = Array.isArray(record.indexed?.attributes) ? record.indexed.attributes : [];
  return [...filters.values()].every((alternatives) => alternatives.some((expected) =>
    attributes.some((stored) => stored.name === expected.name && stored.value === expected.value)));
}

function successEntry(
  id: string,
  claims: FlatClaims,
  status: number,
  type = 'Consent-v5.0.0',
): Record<string, unknown> {
  return {
    type,
    response: { status: String(status) },
    resource: buildClaimsOnlyResource('Consent', id, claims),
  };
}

function errorEntry(entry: ConsentEntry, error: unknown): Record<string, unknown> {
  const managerError = error instanceof ManagerError
    ? error
    : new ManagerError(error instanceof Error ? error.message : String(error), IssueType.Invalid);
  return {
    type: entry.type || 'Consent-v5.0.0',
    response: {
      status: managerError.status,
      outcome: createOperationOutcome(IssueLevel.Error, managerError.code, managerError.message),
    },
    resource: { resourceType: 'OperationOutcome' },
  };
}

function response(
  job: JobRequest,
  type: 'batch-response' | 'searchset',
  data: Record<string, unknown>[],
): IDecodedDidcommPayload {
  return {
    jti: randomUUID(),
    thid: String(job.content?.thid),
    type: 'transaction-response',
    iss: String(job.content?.aud || ''),
    aud: String(job.content?.iss || ''),
    body: { resourceType: 'Bundle', type, total: data.length, data },
  };
}
