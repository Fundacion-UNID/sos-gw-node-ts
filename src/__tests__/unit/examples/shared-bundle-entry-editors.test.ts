import {
  EXAMPLE_CONDITION_CODE,
  EXAMPLE_CONDITION_IDENTIFIER,
  EXAMPLE_COMPOSITION_DATE_MEDICATION_DOCUMENT,
  EXAMPLE_COMPOSITION_IDENTIFIER_MEDICATION_DOCUMENT,
  EXAMPLE_COMPOSITION_TITLE_MEDICATION_DOCUMENT,
  EXAMPLE_MEDICATION_STATEMENT_IDENTIFIER,
  EXAMPLE_MEDICATION_STATEMENT_STATUS,
  EXAMPLE_MEDICATION_STATEMENT_TEXT,
  EXAMPLE_SUBJECT_DID,
  HealthcareBasicSections,
  HealthcareDocumentTypes,
} from 'gdc-common-utils-ts';
import { BundleEditor, BundleEditableResourceTypes, BundleTypes } from 'gdc-common-utils-ts/utils/bundle-editor';
import { BundleReader } from 'gdc-common-utils-ts/utils/bundle-reader';
import { EmployeeBundleOperations } from 'gdc-common-utils-ts/utils/employee';

describe('shared bundle entry editor surface in GW', () => {
  it('exposes the typed clinical entry editors consumed by GW examples', () => {
    const entry = new BundleEditor()
      .setBundleOperation(EmployeeBundleOperations.create)
      .setAllowedResourceType(BundleEditableResourceTypes.observation)
      .newEntry('observation-001');

    const runtimeEntry = entry as unknown as Record<string, unknown>;

    expect(typeof runtimeEntry.asVitalSign).toBe('function');
    expect(typeof runtimeEntry.asObservation).toBe('function');
    expect(typeof runtimeEntry.asAllergy).toBe('function');
    expect(typeof runtimeEntry.asMedicationStatement).toBe('function');
    expect(typeof runtimeEntry.asCondition).toBe('function');
  });

  it('uses typed entry editors for AllergyIntolerance, MedicationStatement, and Condition claims', () => {
    // This is helper-level editing under the canonical document-bundle story, not the primary newbie path.
    const bundle = new BundleEditor()
      .setBundleOperation(EmployeeBundleOperations.create)
      .setBundleType(BundleTypes.document)
      .setCompositionIdentifier(EXAMPLE_COMPOSITION_IDENTIFIER_MEDICATION_DOCUMENT)
      .setCompositionSubject(EXAMPLE_SUBJECT_DID)
      .setCompositionType(HealthcareDocumentTypes.IPS.attributeValue)
      .setCompositionTitle(EXAMPLE_COMPOSITION_TITLE_MEDICATION_DOCUMENT)
      .setCompositionDate(EXAMPLE_COMPOSITION_DATE_MEDICATION_DOCUMENT)
      .setCompositionAuthorList([EXAMPLE_SUBJECT_DID])
      .newEntryAs(BundleEditableResourceTypes.allergyIntolerance, 'allergy-001')
      .setIdentifier('urn:uuid:allergy-001')
      .setSubject(EXAMPLE_SUBJECT_DID)
      .setCode('http://snomed.info/sct|91936005')
      .setClaim(
        'Composition.section',
        HealthcareBasicSections.AllergiesAndIntolerances.attributeValue,
      )
      .doneEntry()
      .newEntryAs(BundleEditableResourceTypes.medicationStatement, 'medication-001')
      .setResourceId('medication-001')
      .setIdentifier(EXAMPLE_MEDICATION_STATEMENT_IDENTIFIER)
      .setSubject(EXAMPLE_SUBJECT_DID)
      .setStatus(EXAMPLE_MEDICATION_STATEMENT_STATUS)
      .setMedicationText(EXAMPLE_MEDICATION_STATEMENT_TEXT)
      .setClaim(
        'Composition.section',
        HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
      )
      .doneEntry()
      .newEntryAs(BundleEditableResourceTypes.condition, 'condition-001')
      .setIdentifier(EXAMPLE_CONDITION_IDENTIFIER)
      .setSubject(EXAMPLE_SUBJECT_DID)
      .setCode(EXAMPLE_CONDITION_CODE)
      .setClaim(
        'Composition.section',
        HealthcareBasicSections.ProblemList.attributeValue,
      )
      .doneEntry()
      .build();

    const reader = new BundleReader(bundle);

    // A document build materializes the three authored clinical entries plus
    // the Composition root and the Patient projection derived from its subject.
    expect(reader.getTotalOperations()).toBe(5);
    expect(bundle.entry).toHaveLength(5);
    expect(bundle.entry?.map((entry: any) => entry.resource?.resourceType)).toEqual(
      expect.arrayContaining([
        'Composition',
        'Patient',
        'AllergyIntolerance',
        'MedicationStatement',
        'Condition',
      ]),
    );

    const entries = reader.getEntries() as Array<{
      resource?: {
        meta?: {
          claims?: Record<string, unknown>;
        };
      };
    }>;

    const clinicalEntries = entries.filter((entry) =>
      ['AllergyIntolerance', 'MedicationStatement', 'Condition'].includes(
        String((entry.resource as any)?.resourceType || ''),
      ),
    );
    expect(clinicalEntries).toHaveLength(3);

    expect(clinicalEntries[0]?.resource?.meta?.claims).toEqual(
      expect.objectContaining({
        'AllergyIntolerance.identifier': 'urn:uuid:allergy-001',
        'AllergyIntolerance.subject': EXAMPLE_SUBJECT_DID,
        'Composition.section': HealthcareBasicSections.AllergiesAndIntolerances.attributeValue,
      }),
    );
    expect(clinicalEntries[1]?.resource?.meta?.claims).toEqual(
      expect.objectContaining({
        'MedicationStatement.identifier': EXAMPLE_MEDICATION_STATEMENT_IDENTIFIER,
        'MedicationStatement.subject': EXAMPLE_SUBJECT_DID,
        'MedicationStatement.code-text': EXAMPLE_MEDICATION_STATEMENT_TEXT,
      }),
    );
    expect(clinicalEntries[2]?.resource?.meta?.claims).toEqual(
      expect.objectContaining({
        'Condition.identifier': EXAMPLE_CONDITION_IDENTIFIER,
        'Condition.subject': EXAMPLE_SUBJECT_DID,
        'Condition.code': EXAMPLE_CONDITION_CODE,
      }),
    );
  });
});
