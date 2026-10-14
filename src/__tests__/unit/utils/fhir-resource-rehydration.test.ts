// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { describe, expect, it } from '@jest/globals';
import { buildFhirResourceFromIndexedClaims } from '../../../utils/fhir-resource-rehydration';
import { ResourceTypesFhirR4 } from '../../../shared/fhir-constants';

describe('fhir-resource-rehydration utils', () => {
  it('publishes coded animal observations without persistence envelopes or private index text', () => {
    const animalObservation = buildFhirResourceFromIndexedClaims(ResourceTypesFhirR4.Observation, {
      id: 'animal-observation-research-1',
      audit: { sourceRecordId: 'animal-observation-operational-1' },
      indexed: {
        attributes: [{
          name: '__digitalTwinSearch.text',
          value: 'Original veterinary terminology display',
        }],
      },
      meta: { internalRevision: '1' },
      tag: [{ system: 'urn:private', code: 'internal' }],
      status: 'stored',
      sequence: 7,
      contentType: 'application/json',
      content: { internal: true },
      'Observation.subject': 'urn:uuid:00000000-0000-4000-8000-000000000001',
      'Observation.status': 'final',
      'Observation.code': 'http://loinc.org|8310-5',
      'Observation.code-display': 'Body temperature',
      'Observation.code-text': 'Temperatura corporal',
      'Observation.language': 'es',
      '__digitalTwinSearch.text': 'Private search copy that is not a clinical claim',
    });

    expect(animalObservation.status).toBe('final');
    expect(animalObservation.code).toEqual({
      text: 'Temperatura corporal',
      coding: [{ system: 'http://loinc.org', code: '8310-5', display: 'Body temperature' }],
    });
    expect(animalObservation.meta.claims).toMatchObject({
      'Observation.status': 'final',
      'Observation.code': 'http://loinc.org|8310-5',
    });
    for (const storageEnvelopeKey of [
      'id', 'audit', 'indexed', 'meta', 'tag', 'status', 'sequence', 'contentType', 'content',
    ]) {
      expect(animalObservation.meta.claims).not.toHaveProperty(storageEnvelopeKey);
    }
    expect(JSON.stringify(animalObservation)).not.toContain('Private search copy that is not a clinical claim');
  });

  it('rehydrates MedicationStatement using shared resource-type constants and medication text/display claims', () => {
    const resource = buildFhirResourceFromIndexedClaims(ResourceTypesFhirR4.MedicationStatement, {
      id: 'med-1',
      'MedicationStatement.subject': 'Patient/p-1',
      'MedicationStatement.identifier': 'medication-identifier',
      'MedicationStatement.status': 'active',
      'MedicationStatement.medication-text': 'Aspirin 100 mg',
      'MedicationStatement.code-display': 'Aspirin',
      'MedicationStatement.code-text': 'Aspirina',
      'MedicationStatement.code': 'http://snomed.info/sct|123',
      'MedicationStatement.user-selected': 'true',
      'MedicationStatement.effectiveDateTime': '2026-01-01T00:00:00Z',
      'MedicationStatement.language': 'es',
    });

    expect(resource.resourceType).toBe(ResourceTypesFhirR4.MedicationStatement);
    expect(resource.subject).toEqual({ reference: 'Patient/p-1' });
    expect(resource.effectiveDateTime).toBe('2026-01-01T00:00:00Z');
    expect(resource.language).toBe('es');
    expect(resource.medicationCodeableConcept).toEqual({
      text: 'Aspirin 100 mg',
      coding: [{
        system: 'http://snomed.info/sct',
        code: '123',
        display: 'Aspirin',
        userSelected: true,
      }],
    });
  });

  it('rehydrates DocumentReference content and keeps subject/date semantics', () => {
    const resource = buildFhirResourceFromIndexedClaims(ResourceTypesFhirR4.DocumentReference, {
      id: 'doc-1',
      'DocumentReference.subject': 'Patient/p-1',
      'DocumentReference.identifier': 'document-identifier',
      'DocumentReference.contenttype': 'application/pdf',
      'DocumentReference.contenthash': 'cid-123',
      'DocumentReference.location': 'ipfs://cid-123',
      'DocumentReference.description': 'Clinical note',
      'DocumentReference.date': '2026-01-01T00:00:00Z',
    });

    expect(resource.resourceType).toBe(ResourceTypesFhirR4.DocumentReference);
    expect(resource.subject).toEqual({ reference: 'Patient/p-1' });
    expect(resource.date).toBe('2026-01-01T00:00:00Z');
    expect(resource.content).toEqual([{
      attachment: {
        contentType: 'application/pdf',
        url: 'ipfs://cid-123',
        id: 'cid-123',
      },
    }]);
  });

  it('rehydrates DeviceUseStatement with the persisted human device display', () => {
    const resource = buildFhirResourceFromIndexedClaims(ResourceTypesFhirR4.DeviceUseStatement, {
      id: 'device-use-1',
      'DeviceUseStatement.subject': 'Patient/p-1',
      'DeviceUseStatement.status': 'active',
      'DeviceUseStatement.device': 'Device/hip-1',
      'DeviceUseStatement.device-display': 'Hip prosthesis',
      'DeviceUseStatement.recordedon': '2026-01-02T00:00:00Z',
      'DeviceUseStatement.timing-datetime': '2026-01-01T00:00:00Z',
    });

    expect(resource).toMatchObject({
      resourceType: ResourceTypesFhirR4.DeviceUseStatement,
      subject: { reference: 'Patient/p-1' },
      status: 'active',
      device: {
        reference: 'Device/hip-1',
        display: 'Hip prosthesis',
      },
      recordedOn: '2026-01-02T00:00:00Z',
      timingDateTime: '2026-01-01T00:00:00Z',
    });
  });

  it.each([
    ResourceTypesFhirR4.AllergyIntolerance,
    ResourceTypesFhirR4.Condition,
  ])('keeps the manually authored local name when rehydrating %s', (resourceType) => {
    const token = 'http://snomed.info/sct|373270004';
    const resource = buildFhirResourceFromIndexedClaims(resourceType, {
      [`${resourceType}.subject`]: 'did:web:patient.example:p-1',
      [`${resourceType}.code`]: token,
      [`${resourceType}.code-text`]: 'Penicilina',
      [`${resourceType}.code-display`]: 'Penicillin',
      [`${resourceType}.language`]: 'es',
    });

    expect(resource.language).toBe('es');
    expect(resource.code).toEqual({
      text: 'Penicilina',
      coding: [{
        system: 'http://snomed.info/sct',
        code: '373270004',
        display: 'Penicillin',
      }],
    });
    expect(resource.code.text).not.toBe(token);
  });
});
