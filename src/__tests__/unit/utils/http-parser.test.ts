import { describe, expect, it } from '@jest/globals';
import { extractHttpRequestDataAsJson } from '../../../utils/http-parser';

describe('http-parser', () => {
  it('infers application/vnd.api+json when DIDComm payload uses body.data and type is missing', () => {
    const request = extractHttpRequestDataAsJson(
      'http://localhost:3000/acme/cds-ES/v1/health-care/individual/org.schema/Organization/_batch',
      {
        jti: 'jti-001',
        thid: 'thid-001',
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        body: {
          data: [
            {
              type: 'Organization',
              meta: { claims: { '@context': 'org.schema' } },
            },
          ],
        },
      },
      'application/json',
      'POST',
    );

    expect(request.content?.type).toBe('application/vnd.api+json');
  });

  it('infers application/fhir+json with fhirVersion when DIDComm payload uses body.entry and type is missing', () => {
    const request = extractHttpRequestDataAsJson(
      'http://localhost:3000/acme/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch',
      {
        jti: 'jti-002',
        thid: 'thid-002',
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          entry: [
            {
              resource: { resourceType: 'Observation' },
              meta: { claims: { '@context': 'org.hl7.fhir.r4' } },
            },
          ],
        },
      },
      'application/json',
      'POST',
    );

    expect(request.content?.type).toBe('application/fhir+json; fhirVersion=4.0');
  });

  it('preserves explicit payload type when already provided', () => {
    const request = extractHttpRequestDataAsJson(
      'http://localhost:3000/acme/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch',
      {
        jti: 'jti-003',
        thid: 'thid-003',
        iss: 'did:web:sender.example',
        aud: 'did:web:receiver.example',
        type: 'application/custom+json',
        body: {
          resourceType: 'Bundle',
          entry: [],
        },
      },
      'application/json',
      'POST',
    );

    expect(request.content?.type).toBe('application/custom+json');
  });
});
