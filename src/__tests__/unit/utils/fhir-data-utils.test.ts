import { describe, expect, it } from '@jest/globals';
import {
  extractTokenCode,
  normalizeReference,
  pickLatestIsoDate,
  resolveBundleEntryFullUrl,
  resolveBundleEntryKey,
  tokenToCoding,
} from '../../../utils/fhir-data-utils';

describe('fhir-data-utils', () => {
  it('normalizes references and token codes', () => {
    expect(normalizeReference('  Patient/p-1  ')).toBe('Patient/p-1');
    expect(normalizeReference(undefined)).toBeUndefined();
    expect(extractTokenCode('LOINC|60591-5')).toBe('60591-5');
    expect(extractTokenCode('60591-5')).toBe('60591-5');
  });

  it('converts canonical tokens to Coding values', () => {
    expect(tokenToCoding('LOINC|60591-5')).toEqual({
      system: 'http://loinc.org',
      code: '60591-5',
    });
    expect(tokenToCoding('http://snomed.info/sct|123')).toEqual({
      system: 'http://snomed.info/sct',
      code: '123',
    });
  });

  it('picks latest ISO date and resolves bundle entry references', () => {
    expect(pickLatestIsoDate(['2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'])).toBe('2026-01-02T00:00:00Z');

    const resource = {
      resourceType: 'Observation',
      id: 'obs-1',
      identifier: [{ value: 'urn:uuid:obs-1' }],
    };

    expect(resolveBundleEntryKey(undefined, resource)).toBe('urn:uuid:obs-1');
    expect(resolveBundleEntryFullUrl(undefined, { resource })).toBe('urn:uuid:obs-1');
    expect(resolveBundleEntryFullUrl('Observation/obs-1', { resource: { resourceType: 'Observation', id: 'obs-1' } }))
      .toBe('Observation/obs-1');
  });
});
