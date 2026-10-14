import { DataCollectionIds, HealthcareBasicSections, ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/index';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { buildFhirResourceFromIndexedClaims } from './fhir-resource-rehydration';
import { getClaimValue } from './claims';
import { getSubjectScopedSectionId, SubjectSectionScope } from './individual-sections';
import { determineResourceId } from './resource';
import {
  extractTokenCode,
  normalizeReference,
  pickLatestIsoDate,
  resolveBundleEntryFullUrl,
  resolveBundleEntryKey,
  tokenToCoding,
} from './fhir-data-utils';
import { TWIN_COMPOSITION_SECTION_RESOURCE_CONFIG } from '../managers/TwinCompositionManager';
import { canonicalizeFhirClaims } from './claims';
import { SupportedFhirIngestionFormat } from './fhir-ingestion';
import { randomUUID } from 'crypto';
import { Format } from 'gdc-common-utils-ts/constants/Schemas';
import {
  FhirIpsCreatorKinds,
  buildFhirIpsCreatorProvenance,
  resolveClinicalCreatorBinding,
  type ClinicalCreatorBinding,
} from 'gdc-common-utils-ts/utils/fhir-ips-creator-identity';
import { getClinicalCreatorBindingsSectionId } from './clinical-creator-binding';
export { getClinicalCreatorBindingsSectionId } from './clinical-creator-binding';

type BuildConsolidatedIpsBundleDocumentParams = {
  vaultRepository: IVaultRepository;
  tenantVaultId: string;
  subject: string;
  scope: SubjectSectionScope;
  requiredSections: string[];
  excludedSections: string[];
  requiredTypes: string[];
};

function ensureSection(sectionRefs: Map<string, Set<string>>, sectionToken: string): void {
  if (!sectionRefs.has(sectionToken)) {
    sectionRefs.set(sectionToken, new Set<string>());
  }
}

function addSectionReference(sectionRefs: Map<string, Set<string>>, sectionToken: string, reference: string): void {
  ensureSection(sectionRefs, sectionToken);
  sectionRefs.get(sectionToken)!.add(reference);
}

function matchesRequiredTypes(actualType: string, requiredTypes: string[]): boolean {
  if (!requiredTypes.length) return true;
  const actualCode = extractTokenCode(actualType);
  return requiredTypes.some((requiredType) => extractTokenCode(requiredType) === actualCode);
}

function matchesSectionToken(actual: string, expected: string): boolean {
  const split = (value: string): { system: string; code: string } => {
    const normalized = String(value || '').trim();
    const delimiter = normalized.lastIndexOf('|');
    const rawSystem = delimiter >= 0 ? normalized.slice(0, delimiter) : '';
    let system = rawSystem.toLowerCase().replace(/\/$/, '');
    if (system === 'loinc' || system === 'http://loinc.org') system = 'http://loinc.org';
    if (['snomed', 'snomedct', 'http://snomed.info/sct'].includes(system)) {
      system = 'http://snomed.info/sct';
    }
    return {
      system,
      code: extractTokenCode(normalized).toLowerCase(),
    };
  };
  const left = split(actual);
  const right = split(expected);
  return left.code === right.code
    && (!left.system || !right.system || left.system === right.system);
}

function belongsToSection(
  record: Record<string, any>,
  sectionToken: string,
  allowImplicitMembership: boolean,
): boolean {
  const memberships = String(
    getClaimValue<string>(record, 'Composition.section') || '',
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  // A legacy single-section ingestion stored the resource in the section's
  // dedicated collection without repeating Composition.section. That is
  // unambiguous only while reconstructing exactly one Composition section.
  if (memberships.length === 0) return allowImplicitMembership;
  return memberships.some((membership) => matchesSectionToken(membership, sectionToken));
}

function collectCompositionProvenance(
  record: Record<string, any>,
  authorRefs: Set<string>,
  attesters: Map<string, { mode: string; party: { reference: string }; time?: string }>,
  compositionDates: string[],
): void {
  const authorReference = normalizeReference(getClaimValue<string>(record, 'Composition.author'));
  if (authorReference) authorRefs.add(authorReference);

  const attesterReferences = splitClaimValues(getClaimValue<string>(record, 'Composition.attester'));
  const attesterModes = splitClaimValues(getClaimValue<string>(record, 'Composition.attester-mode'));
  const attesterTimes = splitClaimValues(getClaimValue<string>(record, 'Composition.attester-time'));
  attesterReferences.forEach((reference, index) => {
    const mode = attesterModes[index] || attesterModes[0];
    if (!mode) return;
    const time = attesterTimes[index] || attesterTimes[0];
    const value = { mode, party: { reference }, ...(time ? { time } : {}) };
    attesters.set(`${mode}\u0000${reference}\u0000${time || ''}`, value);
  });

  const compositionDate = normalizeReference(getClaimValue<string>(record, 'Composition.date'));
  if (compositionDate) compositionDates.push(compositionDate);
}

/**
 * Reconstructs the authorized FHIR document graph for one subject summary.
 * Section membership comes from persisted `Composition.section`; supporting
 * DocumentReferences are disclosed only when they inherit an authorized
 * direct or transitive document relationship.
 */
export async function buildConsolidatedIpsBundleDocument(
  params: BuildConsolidatedIpsBundleDocumentParams,
): Promise<Record<string, any>> {
  const compositionSectionId = getSubjectScopedSectionId(params.subject, params.scope, 'composition');
  const compositionRecords = await params.vaultRepository.listContainersInSection(params.tenantVaultId, compositionSectionId);

  const sectionRefs = new Map<string, Set<string>>();
  const bundleEntries = new Map<string, { fullUrl?: string; resource: Record<string, any> }>();
  const sectionProvenanceRecords = new Map<string, Record<string, any>>();
  const authorRefs = new Set<string>();
  const attesters = new Map<string, { mode: string; party: { reference: string }; time?: string }>();
  const compositionDates: string[] = [];
  const includedSectionTokens = new Set<string>();

  for (const compositionRecord of compositionRecords as Array<Record<string, any>>) {
    const compositionType = String(
      getClaimValue<string>(compositionRecord, 'Composition.type') || '',
    ).trim();
    if (!matchesRequiredTypes(compositionType, params.requiredTypes)) continue;

    const sectionTokens = String(
      getClaimValue<string>(compositionRecord, 'Composition.section') || '',
    ).split(',').map((value) => value.trim()).filter(Boolean);
    for (const sectionToken of sectionTokens) {
      if (params.excludedSections.some((excluded) => matchesSectionToken(sectionToken, excluded))) continue;
      if (params.requiredSections.length > 0
        && !params.requiredSections.some((required) => matchesSectionToken(sectionToken, required))) continue;
      includedSectionTokens.add(sectionToken);
      ensureSection(sectionRefs, sectionToken);
    }

    collectCompositionProvenance(compositionRecord, authorRefs, attesters, compositionDates);
  }

  const allowImplicitSectionMembership = includedSectionTokens.size === 1;
  for (const sectionToken of includedSectionTokens) {
    const projectionConfigs = TWIN_COMPOSITION_SECTION_RESOURCE_CONFIG[sectionToken] || [];
    for (const projectionConfig of projectionConfigs) {
      for (const collectionIdSuffix of projectionConfig.collectionIds) {
        const resourceSectionId = getSubjectScopedSectionId(params.subject, params.scope, collectionIdSuffix);
        const resourceRecords = await params.vaultRepository.listContainersInSection(params.tenantVaultId, resourceSectionId);
        for (const resourceRecord of resourceRecords) {
          // Observation and Condition collections are shared by several IPS
          // sections. The resource's own Composition.section claim is the
          // authoritative membership authored during document ingestion.
          if (!belongsToSection(resourceRecord, sectionToken, allowImplicitSectionMembership)) continue;
          const resource = buildFhirResourceFromIndexedClaims(projectionConfig.resourceType, resourceRecord);
          const entryKey = resolveBundleEntryKey(undefined, resource);
          // One identifier is one logical clinical resource. Repeated vault
          // rows are historical storage versions; the latest listed row is
          // the current summary representation.
          bundleEntries.set(entryKey, {
            fullUrl: resolveBundleEntryFullUrl(undefined, { resource }),
            resource,
          });
          sectionProvenanceRecords.set(entryKey, resourceRecord);
          addSectionReference(sectionRefs, sectionToken, entryKey);
        }
      }
    }
  }

  // Section writes persist Composition-compatible provenance with each data
  // resource. Only the latest row for a logical resource contributes to the
  // materialized document, matching the entry de-duplication above.
  for (const provenanceRecord of sectionProvenanceRecords.values()) {
    collectCompositionProvenance(provenanceRecord, authorRefs, attesters, compositionDates);
  }

  const documentReferenceSectionId = getSubjectScopedSectionId(params.subject, params.scope, DataCollectionIds.documentReferences);
  const documentReferenceRecords = await params.vaultRepository.listContainersInSection(params.tenantVaultId, documentReferenceSectionId);
  for (const documentReferenceRecord of documentReferenceRecords) {
    const matchingSectionTokens = Array.from(includedSectionTokens)
      .filter((sectionToken) => belongsToSection(documentReferenceRecord, sectionToken, false));
    if (params.requiredSections.length > 0 && matchingSectionTokens.length === 0) {
      continue;
    }
    const resource = buildFhirResourceFromIndexedClaims(ResourceTypesFhirR4.DocumentReference, documentReferenceRecord);
    const entryKey = resolveBundleEntryKey(undefined, resource);
    if (!bundleEntries.has(entryKey)) {
      bundleEntries.set(entryKey, {
        fullUrl: resolveBundleEntryFullUrl(undefined, { resource }),
        resource,
      });
    }
    for (const sectionToken of matchingSectionTokens) {
      addSectionReference(sectionRefs, sectionToken, entryKey);
    }
  }

  const compositionId = `ips-composition-${determineResourceId(params.subject, process.env.NODE_ENV)}`;
  const compositionIdentifier = `urn:uuid:${compositionId}`;
  const compositionSectionTokens = Array.from(sectionRefs.keys());
  const exportedAuthorRefs = new Set<string>();
  let bindings: ClinicalCreatorBinding[] = [];
  if (authorRefs.size > 0) {
    const storedBindings = await params.vaultRepository.listContainersInSection(
      params.tenantVaultId,
      getClinicalCreatorBindingsSectionId(),
    );
    bindings = (storedBindings as unknown[]).filter(isClinicalCreatorBinding);
    for (const operationalAuthor of authorRefs) {
      const binding = resolveClinicalCreatorBinding(bindings, { actorDid: operationalAuthor });
      if (!binding) {
        exportedAuthorRefs.add(operationalAuthor);
        continue;
      }
      const provenance = buildBindingProvenance(binding);
      exportedAuthorRefs.add(provenance.authorReference);
      for (const attester of provenance.attesters) {
        attesters.set(
          `${attester.mode}\u0000${attester.party.reference}\u0000${attester.time || ''}`,
          { ...attester, party: { ...attester.party } },
        );
      }
      for (const entry of provenance.entries) {
        bundleEntries.set(entry.fullUrl, { fullUrl: entry.fullUrl, resource: { ...entry.resource } });
      }
    }
  }
  for (const attester of attesters.values()) {
    const binding = bindings.find(candidate => candidate.authorIdentifier === attester.party.reference);
    if (!binding) continue;
    for (const entry of buildBindingProvenance(binding).entries) {
      bundleEntries.set(entry.fullUrl, { fullUrl: entry.fullUrl, resource: { ...entry.resource } });
    }
  }
  const compositionClaims: Record<string, any> = {
    '@context': Format.FHIR_API,
    'Composition.identifier': compositionIdentifier,
    'Composition.subject': params.subject,
    'Composition.type': HealthcareBasicSections.PatientSummaryDocument.attributeValue,
    'Composition.date': pickLatestIsoDate(compositionDates),
    'Composition.section': compositionSectionTokens.join(','),
  };
  if (exportedAuthorRefs.size > 0) {
    compositionClaims['Composition.author'] = Array.from(exportedAuthorRefs).join(',');
  }
  const exportedAttesters = Array.from(attesters.values());
  if (exportedAttesters.length > 0) {
    compositionClaims['Composition.attester'] = exportedAttesters.map(value => value.party.reference).join(',');
    compositionClaims['Composition.attester-mode'] = exportedAttesters.map(value => value.mode).join(',');
    const times = exportedAttesters.map(value => value.time || '');
    if (times.some(Boolean)) compositionClaims['Composition.attester-time'] = times.join(',');
  }
  const compositionResource: Record<string, any> = {
    resourceType: ResourceTypesFhirR4.Composition,
    id: compositionId,
    identifier: [{ value: compositionIdentifier }],
    status: 'final',
    meta: {
      claims: compositionClaims,
    },
    type: {
      coding: [{
        system: HealthcareBasicSections.PatientSummaryDocument.system,
        code: HealthcareBasicSections.PatientSummaryDocument.code,
        display: 'Patient summary Document',
      }],
    },
    subject: { reference: params.subject },
    date: compositionClaims['Composition.date'],
    title: 'International Patient Summary',
    section: compositionSectionTokens.map((sectionToken) => ({
      code: {
        coding: [tokenToCoding(sectionToken)],
      },
      entry: Array.from(sectionRefs.get(sectionToken) || []).map((reference) => ({ reference })),
    })),
    ...(exportedAuthorRefs.size > 0 ? {
      author: Array.from(exportedAuthorRefs).map((reference) => ({ reference })),
    } : {}),
    ...(exportedAttesters.length > 0 ? { attester: exportedAttesters } : {}),
  };

  return {
    resourceType: ResourceTypesFhirR4.Bundle,
    type: 'document',
    entry: [
      {
        fullUrl: compositionIdentifier,
        resource: compositionResource,
      },
      ...Array.from(bundleEntries.entries()).map(([reference, entry]) => ({
        fullUrl: entry.fullUrl || reference,
        resource: entry.resource,
      })),
    ],
  };
}

function splitClaimValues(value: unknown): string[] {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function buildBindingProvenance(binding: ClinicalCreatorBinding) {
  return binding.kind === FhirIpsCreatorKinds.Professional
    ? buildFhirIpsCreatorProvenance({
        kind: binding.kind,
        actorIdentifier: binding.actorIdentifier,
        authorIdentifier: binding.authorIdentifier,
        organizationReference: binding.ownerIdentifier,
        role: binding.role,
      })
    : binding.kind === FhirIpsCreatorKinds.IndividualMember
      ? buildFhirIpsCreatorProvenance({
          kind: binding.kind,
          actorIdentifier: binding.actorIdentifier,
          authorIdentifier: binding.authorIdentifier,
          subjectReference: binding.ownerIdentifier,
          role: binding.role,
        })
      : buildFhirIpsCreatorProvenance({
          kind: binding.kind,
          actorIdentifier: binding.actorIdentifier,
          authorIdentifier: binding.authorIdentifier,
          subjectReference: binding.ownerIdentifier,
        });
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

export function projectSummaryBundleByFormat(
  bundle: Record<string, any>,
  format: SupportedFhirIngestionFormat,
): Record<string, any> {
  if (format !== 'org.hl7.fhir.api') {
    return bundle;
  }

  return {
    resourceType: ResourceTypesFhirR4.Bundle,
    type: bundle.type || 'document',
    entry: Array.isArray(bundle.entry)
      ? bundle.entry.map((entry: any) => {
        const resource = entry?.resource || {};
        const claims = resource?.meta?.claims && typeof resource.meta.claims === 'object'
          ? canonicalizeFhirClaims(resource.meta.claims as Record<string, any>)
          : {};
        const isComposition = resource?.resourceType === ResourceTypesFhirR4.Composition;
        return {
          fullUrl: String(entry?.fullUrl || '').trim() || `urn:uuid:${String(resource?.id || randomUUID())}`,
          resource: {
            resourceType: String(resource?.resourceType || 'Resource'),
            id: String(resource?.id || ''),
            meta: {
              claims,
            },
            ...(isComposition ? {
              status: resource.status,
              type: resource.type,
              subject: resource.subject,
              date: resource.date,
              title: resource.title,
              section: resource.section,
              author: resource.author,
              attester: resource.attester,
            } : {}),
          },
        };
      })
      : [],
  };
}
