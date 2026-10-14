// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
/**
 * Flow contract: the native FHIR IPS demo carries canonical Coding.display so
 * GW can derive code-display for the anonymous research index while keeping
 * local narrative text out of the Digital Twin projection.
 */
import {
  buildDemoCommunicationBatchSubmitRequest,
  buildDemoDocumentBundle,
  buildDemoMedicationSearchRequest,
  buildDemoIpsSearchRequest,
  demoCommunicationMedicationIpsDefaults,
} from '../../data/demo-communication-medications-ips.data';

describe('demo communication medications IPS fixtures', () => {
  it('defines two canonical medication cases for the 101 demo flow', () => {
    expect(demoCommunicationMedicationIpsDefaults.demoMedicationCases).toHaveLength(2);
    expect(demoCommunicationMedicationIpsDefaults.demoMedicationCases[0]?.demoMedicationText).toBe('Ibuprofen 400 mg');
    expect(demoCommunicationMedicationIpsDefaults.demoMedicationCases[1]?.demoMedicationText).toBe('Paracetamol 600 mg');
  });

  it('renders the first document bundle using the first medication case', () => {
    const bundle = buildDemoDocumentBundle({
      ...demoCommunicationMedicationIpsDefaults,
      thidComm: 'comm-1',
      thidMedSearch: 'med-search-1',
      thidIpsSearch: 'ips-search-1',
      medicationCaseIndex: 0,
    });

    expect(bundle.type).toBe('document');
    expect(bundle.entry?.[0]?.resource?.resourceType).toBe('Composition');
    expect(bundle.entry?.[0]?.resource?.author).toEqual([
      { reference: demoCommunicationMedicationIpsDefaults.externalAuthorUrn },
    ]);
    const medication = bundle.entry?.[1]?.resource as any;
    expect(medication?.id).toBe('medication-ibuprofen-001');
    expect(medication?.medicationCodeableConcept?.text).toBe('Ibuprofen 400 mg');
    expect(medication?.medicationCodeableConcept?.coding?.[0]?.display).toBe('Ibuprofen');
    expect(medication?.meta?.claims?.['org.hl7.fhir.api.MedicationStatement.dose-quantity-value']).toBe(400);
  });

  it('renders the communication submission with the attached document bundle for the second medication case', () => {
    const request = buildDemoCommunicationBatchSubmitRequest({
      ...demoCommunicationMedicationIpsDefaults,
      thidComm: 'comm-2',
      thidMedSearch: 'med-search-2',
      thidIpsSearch: 'ips-search-2',
      medicationCaseIndex: 1,
    });

    const attachmentData = request.body.entry?.[0]?.resource?.payload?.[0]?.contentAttachment?.data;
    expect(typeof attachmentData).toBe('string');
    expect(attachmentData?.length).toBeGreaterThan(20);
    const attachmentBundle = JSON.parse(Buffer.from(String(attachmentData), 'base64').toString('utf8'));
    expect(attachmentBundle.type).toBe('document');
    expect(attachmentBundle.entry?.[0]?.resource?.resourceType).toBe('Composition');
  });

  it('keeps subject-scoped medication and IPS searches anchored to the same subject and IPS document type', () => {
    const medicationSearch = buildDemoMedicationSearchRequest({
      ...demoCommunicationMedicationIpsDefaults,
      thidComm: 'comm-search',
      thidMedSearch: 'med-search',
      thidIpsSearch: 'ips-search',
      medicationCaseIndex: 0,
    });
    const ipsSearch = buildDemoIpsSearchRequest({
      ...demoCommunicationMedicationIpsDefaults,
      thidComm: 'comm-search',
      thidMedSearch: 'med-search',
      thidIpsSearch: 'ips-search',
      medicationCaseIndex: 0,
    });

    expect(medicationSearch.body.data[0]?.resource?.meta?.claims?.['MedicationStatement.subject']).toBe(
      demoCommunicationMedicationIpsDefaults.subjectId,
    );
    expect(ipsSearch.body.entry[0]?.request?.url).toContain(
      encodeURIComponent(demoCommunicationMedicationIpsDefaults.subjectId),
    );
    expect(ipsSearch.body.entry[0]?.request?.url).toContain(
      encodeURIComponent(demoCommunicationMedicationIpsDefaults.loincPatientSummaryDocument),
    );
  });
});
