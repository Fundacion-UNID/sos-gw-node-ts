import { describe, expect, it } from '@jest/globals';
import { COMMUNICATION_INGESTION_ENTRY_EXAMPLE } from '../../../api-examples';

describe('api-examples communication', () => {
  it('uses payload+note (no contained) for FHIR Communication ingestion example', () => {
    const resource: any = COMMUNICATION_INGESTION_ENTRY_EXAMPLE.resource;
    expect(resource.resourceType).toBe('Communication');
    expect(resource.contained).toBeUndefined();
    expect(Array.isArray(resource.payload)).toBe(true);
    expect(resource.payload).toHaveLength(1);
    expect(Array.isArray(resource.note)).toBe(true);
    expect(resource.note).toHaveLength(1);
  });

  it('keeps claims aligned with payload-based Communication shape', () => {
    const claims: any = COMMUNICATION_INGESTION_ENTRY_EXAMPLE.resource.meta.claims;
    expect(claims['Communication.content-attachment-type']).toBe('application/fhir+json');
    expect(claims['Communication.note-text']).toBe('IPS ingestion request');
  });

  it('embeds the IPS document bundle directly in the communication attachment', () => {
    const attachment: any = COMMUNICATION_INGESTION_ENTRY_EXAMPLE.resource.payload[0].contentAttachment;
    const documentBundle = JSON.parse(Buffer.from(attachment.data, 'base64').toString('utf8'));
    expect(documentBundle.resourceType).toBe('Bundle');
    expect(documentBundle.type).toBe('document');
    expect(documentBundle.entry[0]?.resource?.resourceType).toBe('Composition');
  });
});
