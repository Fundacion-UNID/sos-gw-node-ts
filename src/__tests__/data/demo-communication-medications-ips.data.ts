// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { CompositionAttesterModes } from 'gdc-common-utils-ts';
import { EXAMPLE_KYC_CONTROLLER_UUID } from 'gdc-common-utils-ts/examples/shared';

export const demoCommunicationMedicationIpsDefaults = {
  subjectId: 'did:web:api.acme.org:individual:subject-001',
  fhirContextR4: 'org.hl7.fhir.r4',
  fhirContextApi: 'org.hl7.fhir.api',
  fhirBundleBatch: 'batch',
  fhirBundleDocument: 'document',
  communicationResource: 'Communication',
  documentReferenceResource: 'DocumentReference',
  medicationStatementResource: 'MedicationStatement',
  compositionResource: 'Composition',
  claimCommunicationSubject: 'Communication.subject',
  claimCommunicationSent: 'Communication.sent',
  claimCompositionSection: 'Composition.section',
  claimMedicationStatementSubject: 'MedicationStatement.subject',
  loincSectionMedicationHistory: 'LOINC|10160-0',
  loincPatientSummaryDocument: 'http://loinc.org|60591-5',
  loincDocumentPatientSummarySystem: 'http://loinc.org',
  loincDocumentPatientSummaryCode: '60591-5',
  loincDocumentMedicationHistoryCode: '10160-0',
  demoTimestamp: '2026-05-22T10:00:00Z',
  demoCompositionId: 'ips-composition-001',
  demoCompositionTitle: 'IPS Medication Summary',
  externalAuthorUrn: 'urn:uuid:external-ips-source-001',
  demoMedicationCases: [
    {
      demoMedicationId: 'medication-ibuprofen-001',
      demoMedicationDisplay: 'Ibuprofen',
      demoMedicationText: 'Ibuprofen 400 mg',
      demoMedicationNote: 'Take every 8 hours as needed. Keep a 4 hour gap from paracetamol.',
      demoMedicationIdentifier: 'urn:uuid:medication-ibuprofen-001',
      demoMedicationCode: 'http://snomed.info/sct|387207008',
      demoMedicationEffective: '2026-06-01T08:00:00Z',
      demoDoseQuantityValue: 400,
      demoDoseQuantityUnit: 'mg',
      demoTimingFrequency: 1,
      demoTimingPeriod: 8,
      demoTimingPeriodUnit: 'h',
      demoDosageAsNeeded: true,
    },
    {
      demoMedicationId: 'medication-paracetamol-001',
      demoMedicationDisplay: 'Paracetamol',
      demoMedicationText: 'Paracetamol 600 mg',
      demoMedicationNote: 'Take every 8 hours as needed. Keep a 4 hour gap from ibuprofen.',
      demoMedicationIdentifier: 'urn:uuid:medication-paracetamol-001',
      demoMedicationCode: 'http://snomed.info/sct|387517004',
      demoMedicationEffective: '2026-06-01T12:00:00Z',
      demoDoseQuantityValue: 600,
      demoDoseQuantityUnit: 'mg',
      demoTimingFrequency: 1,
      demoTimingPeriod: 8,
      demoTimingPeriodUnit: 'h',
      demoDosageAsNeeded: true,
    },
  ],
  demoDocumentReferenceId: 'ips-document-reference-001',
  demoDocumentReferenceIdentifier: 'urn:uuid:ips-document-reference-001',
  demoDocumentReferenceTitle: 'ips-medications.json',
  demoDocumentReferenceAttachmentTitle: 'ips-document-reference.json',
  attachmentFhirJson: 'application/fhir+json',
  urnIdentifierSystem: 'urn:ietf:rfc:3986',
} as const;

export interface DemoCommunicationMedicationIpsRuntime {
  thidComm: string;
  thidMedSearch: string;
  thidIpsSearch: string;
  medicationCaseIndex?: number;
}

type DemoConfig = typeof demoCommunicationMedicationIpsDefaults & DemoCommunicationMedicationIpsRuntime;
type DemoMedicationCase = DemoConfig['demoMedicationCases'][number];

function encodeBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

export function buildDemoDocumentBundle(config: DemoConfig) {
  const medicationCase = getDemoMedicationCase(config);
  return {
    resourceType: 'Bundle',
    type: config.fhirBundleDocument,
    entry: [
      {
        resource: {
          resourceType: config.compositionResource,
          id: config.demoCompositionId,
          status: 'final',
          type: {
            coding: [
              {
                system: config.loincDocumentPatientSummarySystem,
                code: config.loincDocumentPatientSummaryCode,
                display: 'Patient summary Document',
              },
            ],
          },
          subject: { reference: config.subjectId },
          author: [{ reference: config.externalAuthorUrn }],
          attester: [{
            mode: CompositionAttesterModes.Professional,
            party: { reference: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}` },
          }],
          date: config.demoTimestamp,
          title: config.demoCompositionTitle,
          section: [
            {
              code: {
                coding: [
                  {
                    system: config.loincDocumentPatientSummarySystem,
                    code: config.loincDocumentMedicationHistoryCode,
                    display: 'History of Medication Use',
                  },
                ],
              },
              entry: [{ reference: medicationCase.demoMedicationIdentifier }],
            },
          ],
        },
      },
      {
        resource: {
          resourceType: config.medicationStatementResource,
          id: medicationCase.demoMedicationId,
          status: 'active',
          subject: { reference: config.subjectId },
          effectiveDateTime: medicationCase.demoMedicationEffective,
          medicationCodeableConcept: {
            text: medicationCase.demoMedicationText,
            coding: [{
              system: medicationCase.demoMedicationCode.split('|')[0],
              code: medicationCase.demoMedicationCode.split('|')[1],
              display: medicationCase.demoMedicationDisplay,
            }],
          },
          note: [{ text: medicationCase.demoMedicationNote }],
          identifier: [{ system: config.urnIdentifierSystem, value: medicationCase.demoMedicationIdentifier }],
          meta: {
            claims: {
              '@context': config.fhirContextApi,
              'MedicationStatement.identifier': medicationCase.demoMedicationIdentifier,
              'MedicationStatement.subject': config.subjectId,
              'MedicationStatement.status': 'active',
              'MedicationStatement.medication-text': medicationCase.demoMedicationText,
              'MedicationStatement.code': medicationCase.demoMedicationCode,
              'MedicationStatement.effective': medicationCase.demoMedicationEffective,
              'MedicationStatement.note': medicationCase.demoMedicationNote,
              'MedicationStatement.category': config.loincSectionMedicationHistory,
              'org.hl7.fhir.api.MedicationStatement.dose-quantity-value': medicationCase.demoDoseQuantityValue,
              'org.hl7.fhir.api.MedicationStatement.dose-quantity-unit': medicationCase.demoDoseQuantityUnit,
              'org.hl7.fhir.api.MedicationStatement.timing-frequency': medicationCase.demoTimingFrequency,
              'org.hl7.fhir.api.MedicationStatement.timing-period': medicationCase.demoTimingPeriod,
              'org.hl7.fhir.api.MedicationStatement.timing-period-unit': medicationCase.demoTimingPeriodUnit,
              'org.hl7.fhir.api.MedicationStatement.dosage-asneeded': medicationCase.demoDosageAsNeeded,
            },
          },
        },
      },
    ],
  };
}

// Compatibility helper for older attachment-wrapper assertions.
export function buildDemoDocumentReference(config: DemoConfig) {
  const medicationCase = getDemoMedicationCase(config);
  const documentBundle = buildDemoDocumentBundle(config);
  return {
    resourceType: config.documentReferenceResource,
    id: config.demoDocumentReferenceId,
    subject: { reference: config.subjectId },
    date: medicationCase.demoMedicationEffective,
    description: config.demoCompositionTitle,
    identifier: [{ system: config.urnIdentifierSystem, value: config.demoDocumentReferenceIdentifier }],
    content: [
      {
        attachment: {
          contentType: config.attachmentFhirJson,
          title: config.demoDocumentReferenceTitle,
          data: encodeBase64(JSON.stringify(documentBundle)),
        },
      },
    ],
  };
}

/**
 * Renders the GW async submit payload used by local demo/integration tests.
 *
 * Important boundary:
 * - this is not a full DIDComm plaintext message
 * - it is the GW submit contract: `thid + body`
 * - `body` carries a batch `Bundle` whose first entry is a `Communication`
 * - the `Communication` attachment carries the document bundle directly
 *
 * Real DIDComm wrapping and wallet pack/unpack live upstream in
 * `gdc-common-utils-ts` transport helpers and tests.
 */
export function buildDemoCommunicationBatchSubmitRequest(config: DemoConfig) {
  const documentBundle = buildDemoDocumentBundle(config);
  return {
    thid: config.thidComm,
    body: {
      resourceType: 'Bundle',
      type: config.fhirBundleBatch,
      entry: [
        {
          request: { method: 'POST', url: `individual/${config.fhirContextR4}/${config.communicationResource}` },
          resource: {
            resourceType: config.communicationResource,
            status: 'completed',
            subject: { reference: config.subjectId },
            sent: getDemoMedicationCase(config).demoMedicationEffective,
            meta: { claims: {
              '@context': config.fhirContextR4,
              [config.claimCommunicationSubject]: config.subjectId,
              [config.claimCommunicationSent]: getDemoMedicationCase(config).demoMedicationEffective,
              [config.claimCompositionSection]: config.loincSectionMedicationHistory,
            } },
            payload: [
              {
                contentAttachment: {
                  contentType: config.attachmentFhirJson,
                  title: config.demoCompositionTitle,
                  data: encodeBase64(JSON.stringify(documentBundle)),
                },
              },
            ],
          },
        },
      ],
    },
  };
}

export function buildDemoMedicationSearchRequest(config: DemoConfig) {
  return {
    thid: config.thidMedSearch,
    body: {
      data: [
        {
          type: `${config.medicationStatementResource}-search-request-v1.0`,
          resource: {
            resourceType: config.medicationStatementResource,
            meta: { claims: {
              '@context': config.fhirContextApi,
              [config.claimMedicationStatementSubject]: config.subjectId,
            } },
          },
        },
      ],
    },
  };
}

export function buildDemoIpsSearchRequest(config: DemoConfig) {
  return {
    thid: config.thidIpsSearch,
    body: {
      resourceType: 'Bundle',
      type: config.fhirBundleBatch,
      entry: [
        {
          request: {
            method: 'GET',
            url: `Bundle?type=${encodeURIComponent(config.fhirBundleDocument)}&composition.subject=${encodeURIComponent(config.subjectId)}&composition.type=${encodeURIComponent(config.loincPatientSummaryDocument)}`,
          },
        },
      ],
    },
  };
}

export function getDemoMedicationCase(config: DemoConfig): DemoMedicationCase {
  const index = Math.max(0, Math.min(config.demoMedicationCases.length - 1, Number(config.medicationCaseIndex || 0)));
  return config.demoMedicationCases[index];
}
