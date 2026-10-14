import { describe, expect, it } from '@jest/globals';
import {
  extractCommunicationSearchFilters,
  extractCompositionExcludedSearchSections,
  extractCompositionSearchSections,
  extractCompositionSearchSubject,
  extractCompositionSearchTypes,
  extractDocumentReferenceSearchFilters,
  extractRequestedBundleType,
  extractSearchResourceType,
} from '../../../utils/search-request';

describe('search-request utils', () => {
  it('extracts composition search filters from Parameters and request.url wrappers', () => {
    const body = {
      resourceType: 'Bundle',
      type: 'batch',
      parameter: [
        { name: 'subject', valueString: 'did:web:example:subject:1' },
        { name: 'section', valueString: 'LOINC|10160-0,LOINC|8716-3' },
        { name: 'section:not', valueString: 'LOINC|48765-2' },
        { name: 'composition.type', valueCoding: { system: 'http://loinc.org', code: '60591-5' } },
      ],
      entry: [
        {
          request: {
            method: 'GET',
            url: 'Composition/_search?section=LOINC|10160-0&type=document&composition.type=LOINC|60591-5&exclude-section=LOINC|11348-0',
          },
        },
      ],
    };

    expect(extractCompositionSearchSubject(body)).toBe('did:web:example:subject:1');
    expect(extractCompositionSearchSections(body)).toEqual(['LOINC|10160-0', 'LOINC|8716-3']);
    expect(extractCompositionExcludedSearchSections(body)).toEqual(['LOINC|48765-2', 'LOINC|11348-0']);
    expect(extractCompositionSearchTypes(body)).toEqual(['http://loinc.org|60591-5', 'LOINC|60591-5']);
    expect(extractRequestedBundleType(body)).toBe('document');
    expect(extractSearchResourceType(body)).toBe('composition');
  });

  it('extracts document reference and communication filters from canonical aliases', () => {
    const body = {
      resourceType: 'Parameters',
      parameter: [
        { name: 'documentreference.identifier', valueString: 'doc-1' },
        { name: 'attachment.hash', valueString: 'cid-123' },
        { name: 'communication.identifier', valueString: 'comm-1' },
        { name: 'thid', valueString: 'thread-1' },
        { name: 'pthid', valueString: 'parent-thread-1' },
      ],
    };

    expect(extractDocumentReferenceSearchFilters(body)).toEqual({
      identifier: 'doc-1',
      attachmentHash: 'cid-123',
    });
    expect(extractCommunicationSearchFilters(body)).toEqual({
      identifier: 'comm-1',
      thid: 'thread-1',
      pthid: 'parent-thread-1',
      attachmentHash: 'cid-123',
    });
  });
});
