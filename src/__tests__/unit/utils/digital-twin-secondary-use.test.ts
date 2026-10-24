// Flow contract: secondary-use consent rebuilds only finalized, professionally attested clinical records and never promotes personal records into the research repository.
import { ClaimConsent } from 'gdc-common-utils-ts/models/consent-rule';
import { ServiceCapability } from 'gdc-common-utils-ts/constants/service-capabilities';
import { HealthcareConsentPurposes } from 'gdc-common-utils-ts/constants/healthcare';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import {
  applyDigitalTwinSecondaryUseDecision,
  isDigitalTwinSecondaryUseEnabled,
  listEnabledDigitalTwinStudyTargets,
  purgeDigitalTwinSubjectLink,
} from '../../../utils/digital-twin-secondary-use';
import {
  getDigitalTwinSubjectAliasSectionId,
  getOrCreateDigitalTwinSubjectId,
  isDigitalTwinSubjectId,
  isRegisteredDigitalTwinSubjectId,
} from '../../../utils/digital-twin-research-projection';
import { getSubjectScopedSectionId } from '../../../utils/individual-sections';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';

describe('digital twin secondary-use lifecycle', () => {
  const tenantVaultId = 'health-care_acme';
  const sourceSubject = 'did:web:api.acme.org:individual:subject-001';
  const portalConsentSource = 'https://portal.example/research';
  const studyConsentSource = 'urn:study:b';
  const baseClaims = {
    '@context': 'org.hl7.fhir.api',
    [ClaimConsent.subject]: sourceSubject,
    [ClaimConsent.purpose]: HealthcareConsentPurposes.Research,
    [ClaimConsent.action]: ServiceCapability.DigitalTwinReader,
  };
  const professionalProvenance = {
    'Composition.attester': 'PractitionerRole/clinician-1',
    'Composition.attester-mode': 'professional',
  };

  it('does not project before an explicit secondary-use permit', async () => {
    const vaultRepository = new VaultMemRepository();
    expect(await isDigitalTwinSecondaryUseEnabled({ vaultRepository, tenantVaultId, sourceSubject })).toBe(false);
  });

  it('accepts only UUID URNs registered by the tenant alias vault', async () => {
    const vaultRepository = new VaultMemRepository();
    const twinSubjectId = await getOrCreateDigitalTwinSubjectId({ vaultRepository, tenantVaultId, sourceSubject });

    expect(isDigitalTwinSubjectId(twinSubjectId)).toBe(true);
    expect(isDigitalTwinSubjectId(sourceSubject)).toBe(false);
    expect(await isRegisteredDigitalTwinSubjectId({ vaultRepository, tenantVaultId, twinSubjectId })).toBe(true);
    expect(await isRegisteredDigitalTwinSubjectId({
      vaultRepository,
      tenantVaultId,
      twinSubjectId: 'urn:uuid:00000000-0000-4000-8000-000000000999',
    })).toBe(false);
  });

  it('allocates an unlinkable twin per ResearchStudy instead of one twin per person', async () => {
    const vaultRepository = new VaultMemRepository();
    const studyA = 'https://research.example/studies/alpha';
    const studyB = 'https://research.example/studies/beta';

    const twinA = await getOrCreateDigitalTwinSubjectId({
      vaultRepository, tenantVaultId, sourceSubject, researchUseReference: studyA,
    });
    const twinAReplay = await getOrCreateDigitalTwinSubjectId({
      vaultRepository, tenantVaultId, sourceSubject, researchUseReference: studyA,
    });
    const twinB = await getOrCreateDigitalTwinSubjectId({
      vaultRepository, tenantVaultId, sourceSubject, researchUseReference: studyB,
    });

    expect(twinAReplay).toBe(twinA);
    expect(twinB).not.toBe(twinA);
    expect(await vaultRepository.listContainersInSection<any>(
      tenantVaultId,
      getDigitalTwinSubjectAliasSectionId(),
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ twinSubjectId: twinA, researchUseReference: studyA }),
      expect.objectContaining({ twinSubjectId: twinB, researchUseReference: studyB }),
    ]));
  });

  it('keeps study participation decisions and projection targets independent', async () => {
    const vaultRepository = new VaultMemRepository();
    const studyA = 'https://research.example/studies/alpha';
    const studyB = 'https://research.example/studies/beta';
    await vaultRepository.put(tenantVaultId, [{
      id: 'verified-composition',
      'Composition.identifier': 'urn:uuid:verified-composition',
      'Composition.subject': sourceSubject,
      'Composition.section': 'LOINC|8716-3',
      'Composition.status': 'final',
      ...professionalProvenance,
    }], getSubjectScopedSectionId(sourceSubject, 'individual', 'composition'));

    for (const researchUseReference of [studyA, studyB]) {
      await applyDigitalTwinSecondaryUseDecision({
        vaultRepository,
        tenantVaultId,
        claims: {
          ...baseClaims,
          [ClaimConsent.sourceReference]: researchUseReference,
          [ClaimConsent.decision]: 'permit',
        },
      });
    }

    const targets = await listEnabledDigitalTwinStudyTargets({
      vaultRepository, tenantVaultId, sourceSubject,
    });
    expect(targets).toHaveLength(2);
    expect(new Set(targets.map((target) => target.twinSubjectId)).size).toBe(2);
    expect(targets.map((target) => target.researchUseReference).sort()).toEqual([studyA, studyB]);
    expect(targets.every((target) => typeof target.lastSharedAt === 'string')).toBe(true);

    await applyDigitalTwinSecondaryUseDecision({
      vaultRepository,
      tenantVaultId,
      claims: {
        ...baseClaims,
        [ClaimConsent.sourceReference]: studyA,
        [ClaimConsent.decision]: 'deny',
      },
    });

    expect(await isDigitalTwinSecondaryUseEnabled({
      vaultRepository, tenantVaultId, sourceSubject, researchUseReference: studyA,
    })).toBe(false);
    expect(await isDigitalTwinSecondaryUseEnabled({
      vaultRepository, tenantVaultId, sourceSubject, researchUseReference: studyB,
    })).toBe(true);
    expect(await listEnabledDigitalTwinStudyTargets({
      vaultRepository, tenantVaultId, sourceSubject,
    })).toEqual([
      expect.objectContaining({ researchUseReference: studyB }),
    ]);
  });

  it('disables synchronization without deleting the published twin and rebuilds one multi-section Composition when re-enabled', async () => {
    const vaultRepository = new VaultMemRepository();
    const twinSubjectId = await getOrCreateDigitalTwinSubjectId({ vaultRepository, tenantVaultId, sourceSubject });
    const sourceCompositionSection = getSubjectScopedSectionId(sourceSubject, 'individual', 'composition');
    const sourceMedicationSection = getSubjectScopedSectionId(sourceSubject, 'individual', 'medications');
    const twinCompositionSection = getSubjectScopedSectionId(twinSubjectId, 'digitaltwin', 'composition');
    const twinMedicationSection = getSubjectScopedSectionId(twinSubjectId, 'digitaltwin', 'medications');

    await vaultRepository.put(tenantVaultId, [
      {
        id: 'legacy-composition-medications',
        '@context': 'org.hl7.fhir.r4',
        'Composition.identifier': 'urn:uuid:ips-001',
        'Composition.subject': sourceSubject,
        'Composition.section': 'LOINC|10160-0',
        'Composition.type': 'LOINC|60591-5',
        'Composition.status': 'final',
        ...professionalProvenance,
      },
      {
        id: 'legacy-composition-vitals',
        '@context': 'org.hl7.fhir.r4',
        'Composition.identifier': 'urn:uuid:ips-001',
        'Composition.subject': sourceSubject,
        'Composition.section': 'LOINC|8716-3',
        'Composition.type': 'LOINC|60591-5',
        'Composition.status': 'final',
        ...professionalProvenance,
      },
    ], sourceCompositionSection);
    await vaultRepository.put(tenantVaultId, [{
      id: 'medication-001',
      '@context': 'org.hl7.fhir.r4',
      'MedicationStatement.identifier': 'urn:uuid:medication-001',
      'MedicationStatement.subject': sourceSubject,
      'MedicationStatement.code': 'http://snomed.info/sct|108575001',
      'Composition.section': 'LOINC|10160-0',
      ...professionalProvenance,
    }], sourceMedicationSection);
    await vaultRepository.put(tenantVaultId, [{
      id: 'published-before-withdrawal',
      'Composition.subject': twinSubjectId,
      'Composition.section': 'LOINC|10160-0',
    }], twinCompositionSection);

    await applyDigitalTwinSecondaryUseDecision({
      vaultRepository,
      tenantVaultId,
      claims: { ...baseClaims, [ClaimConsent.decision]: 'deny' },
    });

    expect(await isDigitalTwinSecondaryUseEnabled({ vaultRepository, tenantVaultId, sourceSubject })).toBe(false);
    expect(await vaultRepository.listContainersInSection(tenantVaultId, twinCompositionSection)).toHaveLength(1);
    expect(await vaultRepository.listContainersInSection(tenantVaultId, sourceCompositionSection)).toHaveLength(2);
    expect(await vaultRepository.listContainersInSection(tenantVaultId, getDigitalTwinSubjectAliasSectionId())).toHaveLength(1);

    await applyDigitalTwinSecondaryUseDecision({
      vaultRepository,
      tenantVaultId,
      claims: { ...baseClaims, [ClaimConsent.decision]: 'permit' },
    });

    expect(await isDigitalTwinSecondaryUseEnabled({ vaultRepository, tenantVaultId, sourceSubject })).toBe(true);
    const compositions = await vaultRepository.listContainersInSection<any>(tenantVaultId, twinCompositionSection);
    expect(compositions).toHaveLength(1);
    expect(String(compositions[0]['Composition.section']).split(',')).toEqual([
      'LOINC|10160-0',
      'LOINC|8716-3',
    ]);
    expect(compositions[0]['Composition.subject']).toBe(twinSubjectId);
    const medications = await vaultRepository.listContainersInSection<any>(tenantVaultId, twinMedicationSection);
    expect(medications).toHaveLength(1);
    expect(medications[0]['MedicationStatement.subject']).toBe(twinSubjectId);
  });

  it('rebuilds only finalized Observations and Compositions', async () => {
    const vaultRepository = new VaultMemRepository();
    const observationSection = getSubjectScopedSectionId(sourceSubject, 'individual', 'observations');
    const compositionSection = getSubjectScopedSectionId(sourceSubject, 'individual', 'composition');
    await vaultRepository.put(tenantVaultId, [{
      id: 'observation-final',
      'Observation.identifier': 'urn:uuid:observation-final',
      'Observation.subject': sourceSubject,
      'Observation.status': 'final',
      ...professionalProvenance,
    }, {
      id: 'observation-preliminary',
      'Observation.identifier': 'urn:uuid:observation-preliminary',
      'Observation.subject': sourceSubject,
      'Observation.status': 'preliminary',
      ...professionalProvenance,
    }, {
      id: 'observation-personal-final',
      'Observation.identifier': 'urn:uuid:observation-personal-final',
      'Observation.subject': sourceSubject,
      'Observation.status': 'final',
      'Composition.attester': 'RelatedPerson/family-1',
      'Composition.attester-mode': 'personal',
    }], observationSection);
    await vaultRepository.put(tenantVaultId, [{
      id: 'composition-final',
      'Composition.identifier': 'urn:uuid:composition-final',
      'Composition.subject': sourceSubject,
      'Composition.section': 'LOINC|8716-3',
      'Composition.status': 'final',
      ...professionalProvenance,
    }, {
      id: 'composition-preliminary',
      'Composition.identifier': 'urn:uuid:composition-preliminary',
      'Composition.subject': sourceSubject,
      'Composition.section': 'LOINC|8716-3',
      'Composition.status': 'preliminary',
      ...professionalProvenance,
    }], compositionSection);

    await applyDigitalTwinSecondaryUseDecision({
      vaultRepository,
      tenantVaultId,
      claims: { ...baseClaims, [ClaimConsent.decision]: 'permit' },
    });

    const twinSubjectId = (await vaultRepository.listContainersInSection<any>(
      tenantVaultId,
      getDigitalTwinSubjectAliasSectionId(),
    ))[0].twinSubjectId;
    const observations = await vaultRepository.listContainersInSection<any>(
      tenantVaultId,
      getSubjectScopedSectionId(twinSubjectId, 'digitaltwin', 'observations'),
    );
    const compositions = await vaultRepository.listContainersInSection<any>(
      tenantVaultId,
      getSubjectScopedSectionId(twinSubjectId, 'digitaltwin', 'composition'),
    );
    expect(observations).toHaveLength(1);
    expect(observations[0][`${ResourceTypesFhirR4.Observation}.status`]).toBe('final');
    expect(compositions).toHaveLength(1);
    expect(compositions[0][`${ResourceTypesFhirR4.Composition}.status`]).toBe('final');
  });

  it('purges only the private provider binding and allocates a new UUID after later enrollment', async () => {
    const vaultRepository = new VaultMemRepository();
    const oldTwinSubjectId = await getOrCreateDigitalTwinSubjectId({ vaultRepository, tenantVaultId, sourceSubject });
    const sourceCompositionSection = getSubjectScopedSectionId(sourceSubject, 'individual', 'composition');
    const oldTwinCompositionSection = getSubjectScopedSectionId(oldTwinSubjectId, 'digitaltwin', 'composition');
    await vaultRepository.put(tenantVaultId, [{
      id: 'ips-source',
      '@context': 'org.hl7.fhir.r4',
      'Composition.identifier': 'urn:uuid:ips-purge-test',
      'Composition.subject': sourceSubject,
      'Composition.section': 'LOINC|10160-0',
      'Composition.type': 'LOINC|60591-5',
      'Composition.status': 'final',
      ...professionalProvenance,
    }], sourceCompositionSection);
    await vaultRepository.put(tenantVaultId, [{
      id: 'anonymous-twin-before-offboarding',
      'Composition.subject': oldTwinSubjectId,
      'Composition.section': 'LOINC|10160-0',
    }], oldTwinCompositionSection);

    const purge = await purgeDigitalTwinSubjectLink({ vaultRepository, tenantVaultId, sourceSubject });
    expect(purge).toEqual({ purged: true, detachedTwinSubjectId: oldTwinSubjectId });
    expect(await isRegisteredDigitalTwinSubjectId({ vaultRepository, tenantVaultId, twinSubjectId: oldTwinSubjectId })).toBe(false);
    expect(await vaultRepository.listContainersInSection(tenantVaultId, oldTwinCompositionSection)).toHaveLength(1);
    expect(await isDigitalTwinSecondaryUseEnabled({ vaultRepository, tenantVaultId, sourceSubject })).toBe(false);

    await applyDigitalTwinSecondaryUseDecision({
      vaultRepository,
      tenantVaultId,
      claims: { ...baseClaims, [ClaimConsent.decision]: 'permit' },
    });
    const aliases = await vaultRepository.listContainersInSection<any>(tenantVaultId, getDigitalTwinSubjectAliasSectionId());
    expect(aliases).toHaveLength(1);
    const newTwinSubjectId = aliases[0].twinSubjectId;
    expect(newTwinSubjectId).not.toBe(oldTwinSubjectId);
    expect(isDigitalTwinSubjectId(newTwinSubjectId)).toBe(true);
    expect(await vaultRepository.listContainersInSection(tenantVaultId, oldTwinCompositionSection)).toHaveLength(1);
    expect(await vaultRepository.listContainersInSection(
      tenantVaultId,
      getSubjectScopedSectionId(newTwinSubjectId, 'digitaltwin', 'composition'),
    )).toHaveLength(1);
  });

  it('keeps projection enabled while another portal or study still permits use', async () => {
    const vaultRepository = new VaultMemRepository();
    await applyDigitalTwinSecondaryUseDecision({
      vaultRepository,
      tenantVaultId,
      claims: {
        ...baseClaims,
        [ClaimConsent.sourceReference]: studyConsentSource,
        [ClaimConsent.decision]: 'permit',
      },
    });

    await applyDigitalTwinSecondaryUseDecision({
      vaultRepository,
      tenantVaultId,
      claims: {
        ...baseClaims,
        [ClaimConsent.sourceReference]: portalConsentSource,
        [ClaimConsent.decision]: 'deny',
      },
    });
    expect(await isDigitalTwinSecondaryUseEnabled({ vaultRepository, tenantVaultId, sourceSubject })).toBe(true);

    await applyDigitalTwinSecondaryUseDecision({
      vaultRepository,
      tenantVaultId,
      claims: {
        ...baseClaims,
        [ClaimConsent.sourceReference]: studyConsentSource,
        [ClaimConsent.decision]: 'deny',
      },
    });
    expect(await isDigitalTwinSecondaryUseEnabled({ vaultRepository, tenantVaultId, sourceSubject })).toBe(false);
  });
});
