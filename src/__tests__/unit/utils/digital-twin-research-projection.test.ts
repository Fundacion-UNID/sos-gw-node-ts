// Flow contract: GW admits only professionally attested clinical records to research, prefers governed terminology labels, and retains clinical-service labels only as a visible fallback when exact translation is unavailable.
import { jest } from '@jest/globals';
import {
  DIGITAL_TWIN_SEARCH_DATE_CLAIM,
  DIGITAL_TWIN_SEARCH_LANGUAGE_CLAIM,
  DIGITAL_TWIN_SEARCH_TEXT_CLAIM,
  getDigitalTwinSubjectAliasSectionId,
  getOrCreateDigitalTwinSubjectId,
  isProfessionallyAttestedResearchRecord,
  isDigitalTwinResearchResourceType,
  projectClaimsForDigitalTwin,
  resolveAndProjectClaimsForDigitalTwin,
} from '../../../utils/digital-twin-research-projection';

describe('digital twin research projection', () => {
  it('creates one private stable twin subject alias without persisting the operational DID', async () => {
    const records = new Map<string, any>();
    const vaultRepository = {
      get: jest.fn(async (_vaultId: string, id: string) => records.get(id)),
      put: jest.fn(async (_vaultId: string, items: any[]) => {
        items.forEach((item) => records.set(item.id, item));
        return true;
      }),
    } as any;
    const sourceSubject = 'did:web:api.acme.org:individual:123';
    const first = await getOrCreateDigitalTwinSubjectId({ vaultRepository, tenantVaultId: 'health-care_acme', sourceSubject });
    const second = await getOrCreateDigitalTwinSubjectId({ vaultRepository, tenantVaultId: 'health-care_acme', sourceSubject });
    expect(first).toBe(second);
    expect(first).toMatch(/^urn:uuid:/);
    expect(vaultRepository.put).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([...records.values()])).not.toContain(sourceSubject);
    expect(getDigitalTwinSubjectAliasSectionId()).toContain('digitaltwin_subject_aliases');
  });

  it('uses only trusted resolved terminology labels while removing caller text and replacing identifiers', () => {
    const twinSubjectId = 'urn:uuid:00000000-0000-4000-8000-000000000001';
    const projected = projectClaimsForDigitalTwin({
      resourceType: 'MedicationStatement',
      twinSubjectId,
      claims: {
        '@context': 'org.hl7.fhir.r4',
        'MedicationStatement.identifier': 'clinical-medication-123',
        'MedicationStatement.subject': 'did:web:api.acme.org:individual:123',
        'MedicationStatement.patient': 'did:web:api.acme.org:individual:123',
        'MedicationStatement.code': 'http://snomed.info/sct|387207008',
        'MedicationStatement.dosage-instruction': 'Take after dinner',
        'MedicationStatement.code-text': 'Ibuprofeno',
        'MedicationStatement.code-display': 'Ibuprofen',
        'MedicationStatement.effective-dateTime': '2026-08-20T10:30:00.000Z',
        'MedicationStatement.language': 'es',
        'MedicationStatement.medication-text': 'Alice takes ibuprofen',
        'MedicationStatement.note': 'Call Alice on 555-0100',
      },
      terminology: {
        codeClaim: 'MedicationStatement.code',
        textClaim: 'MedicationStatement.code-text',
        displayClaim: 'MedicationStatement.code-display',
        system: 'http://snomed.info/sct',
        code: '387207008',
        text: 'Ibuprofeno normalizado',
        display: 'Ibuprofen normalized',
        textLanguage: 'es',
        displayLanguage: 'en',
      },
    });
    expect(projected['MedicationStatement.subject']).toBe(twinSubjectId);
    expect(projected['MedicationStatement.identifier']).toMatch(/^urn:uuid:/);
    expect(projected['MedicationStatement.identifier']).not.toBe('clinical-medication-123');
    expect(projected['MedicationStatement.code']).toBe('http://snomed.info/sct|387207008');
    expect(projected['MedicationStatement.code-text']).toBe('Ibuprofeno normalizado');
    expect(projected['MedicationStatement.code-display']).toBe('Ibuprofen normalized');
    expect(projected).not.toHaveProperty('MedicationStatement.patient');
    expect(projected).not.toHaveProperty('MedicationStatement.dosage-instruction');
    expect(projected).not.toHaveProperty('MedicationStatement.medication-text');
    expect(projected).not.toHaveProperty('MedicationStatement.note');
    // Basic portal search must resolve both a confirmed terminology code and
    // its English display without exposing this private derived index.
    expect(projected[DIGITAL_TWIN_SEARCH_TEXT_CLAIM]).toBe(
      'http://snomed.info/sct|387207008\u001fIbuprofeno normalizado\u001fIbuprofen normalized',
    );
    expect(projected[DIGITAL_TWIN_SEARCH_DATE_CLAIM]).toBe('2026-08-20T10:30:00.000Z');
    expect(projected[DIGITAL_TWIN_SEARCH_LANGUAGE_CLAIM]).toBe('es');
  });

  it('rejects identity-bearing resource families from the research plane', () => {
    expect(isDigitalTwinResearchResourceType('Patient')).toBe(false);
    expect(isDigitalTwinResearchResourceType('RelatedPerson')).toBe(false);
    expect(isDigitalTwinResearchResourceType('Consent')).toBe(false);
  });

  it('accepts only a professional attester as clinical research provenance', () => {
    expect(isProfessionallyAttestedResearchRecord({
      'Composition.attester': 'PractitionerRole/clinician-1',
      'Composition.attester-mode': 'professional',
    })).toBe(true);
    expect(isProfessionallyAttestedResearchRecord({
      'Composition.attester': 'RelatedPerson/family-1',
      'Composition.attester-mode': 'personal',
    })).toBe(false);
    expect(isProfessionallyAttestedResearchRecord({
      'Composition.attester': 'PractitionerRole/untyped-1',
    })).toBe(false);
  });

  it('keeps a code-only projection but blocks registration when enabled terminology is unavailable', async () => {
    process.env.RESEARCH_TERMINOLOGY_BASE_URL = 'https://terminology.example';
    process.env.RESEARCH_TERMINOLOGY_LABELS_ENABLED = 'true';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 503 } as Response);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result: any = await resolveAndProjectClaimsForDigitalTwin({
        resourceType: 'Observation', sector: 'animal-care', jurisdiction: 'ES',
        twinSubjectId: 'urn:uuid:00000000-0000-4000-8000-000000000001',
        claims: {
          'Observation.code': 'http://loinc.org|8310-5',
          'Observation.code-text': 'Temperatura corporal',
          'Observation.code-display': 'Body temperature',
          'Composition.attester': 'PractitionerRole/clinician-1',
          'Composition.attester-mode': 'professional',
        },
      });
      expect(result.claims['Observation.code']).toBe('http://loinc.org|8310-5');
      expect(result.claims).not.toHaveProperty('Observation.code-text');
      expect(result.claims).not.toHaveProperty('Observation.code-display');
      expect(result.researchReady).toBe(false);
      expect(result.warning).toMatchObject({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'warning', code: 'processing' }],
      });
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      delete process.env.RESEARCH_TERMINOLOGY_BASE_URL;
      delete process.env.RESEARCH_TERMINOLOGY_LABELS_ENABLED;
      fetchSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('keeps only the original medication code-text as an explicit unreviewed fallback when code is absent', async () => {
    const result: any = await resolveAndProjectClaimsForDigitalTwin({
      resourceType: 'MedicationStatement', sector: 'health-care', jurisdiction: 'ES',
      twinSubjectId: 'urn:uuid:00000000-0000-4000-8000-000000000001',
      claims: {
        'MedicationStatement.subject': 'did:web:api.example:individual:123',
        'MedicationStatement.code-text': 'Ibuprofeno preparado para Alice',
        'MedicationStatement.user-selected': 'true',
        'MedicationStatement.language': 'es',
        'MedicationStatement.note': 'Call Alice on 555-0100',
        'Composition.attester': 'PractitionerRole/clinician-1',
        'Composition.attester-mode': 'professional',
      },
    });

    expect(result.claims['MedicationStatement.code']).toBeUndefined();
    expect(result.claims['MedicationStatement.code-text']).toBe('Ibuprofeno preparado para Alice');
    expect(result.claims['MedicationStatement.user-selected']).toBe('false');
    expect(result.claims).not.toHaveProperty('MedicationStatement.code-display');
    expect(result.claims).not.toHaveProperty('MedicationStatement.note');
    expect(result.claims[DIGITAL_TWIN_SEARCH_TEXT_CLAIM]).toBe('Ibuprofeno preparado para Alice');
    expect(result.warning).toMatchObject({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'warning', code: 'incomplete' }],
    });
    expect(result.researchReady).toBe(false);
  });

  it('does not call terminology when host label enrichment is disabled', async () => {
    process.env.RESEARCH_TERMINOLOGY_BASE_URL = 'https://terminology.example';
    delete process.env.RESEARCH_TERMINOLOGY_LABELS_ENABLED;
    const fetchSpy = jest.spyOn(global, 'fetch');
    try {
      const result = await resolveAndProjectClaimsForDigitalTwin({
        resourceType: 'Observation', sector: 'animal-care', jurisdiction: 'CA-BC',
        twinSubjectId: 'urn:uuid:00000000-0000-4000-8000-000000000001',
        claims: {
          'Observation.code': 'http://loinc.org|8310-5',
          'Observation.code-text': 'Temperatura corporal',
          'Observation.code-display': 'Body temperature',
          'Composition.attester': 'PractitionerRole/clinician-1',
          'Composition.attester-mode': 'professional',
        },
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.researchReady).toBe(true);
      expect(result.claims['Observation.code']).toBe('http://loinc.org|8310-5');
      expect(result.claims).not.toHaveProperty('Observation.code-text');
      expect(result.claims).not.toHaveProperty('Observation.code-display');
      expect(result.warning).toBeUndefined();
    } finally {
      delete process.env.RESEARCH_TERMINOLOGY_BASE_URL;
      fetchSpy.mockRestore();
    }
  });
});
