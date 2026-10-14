import { describe, expect, it } from '@jest/globals';
import {
  filterCompositionMatchesBySectionsAndTypes,
  filterDocumentReferenceMatches,
} from '../../../utils/composition-search';

describe('composition-search utils', () => {
  it('filters document references by identifier and content hash', () => {
    const matches = [
      {
        'DocumentReference.identifier': 'doc-1',
        'DocumentReference.contenthash': 'cid-1',
      },
      {
        'org.hl7.fhir.r4.DocumentReference.identifier': 'doc-2',
        'org.hl7.fhir.r4.DocumentReference.contenthash': 'cid-2',
      },
    ];

    expect(filterDocumentReferenceMatches(matches, { identifier: 'doc-2' })).toEqual([matches[1]]);
    expect(filterDocumentReferenceMatches(matches, { attachmentHash: 'cid-1' })).toEqual([matches[0]]);
  });

  it('filters compositions by section inclusion, exclusion, and type', () => {
    const matches = [
      {
        'Composition.section': 'LOINC|10160-0,LOINC|48765-2',
        'Composition.type': 'LOINC|60591-5',
      },
      {
        'org.hl7.fhir.r4.Composition.section': 'LOINC|8716-3',
        'org.hl7.fhir.r4.Composition.type': 'LOINC|34133-9',
      },
    ];

    expect(filterCompositionMatchesBySectionsAndTypes(matches, ['LOINC|10160-0'], [], [])).toEqual([matches[0]]);
    expect(filterCompositionMatchesBySectionsAndTypes(matches, [], ['LOINC|48765-2'], [])).toEqual([matches[1]]);
    expect(filterCompositionMatchesBySectionsAndTypes(matches, [], [], ['LOINC|34133-9'])).toEqual([matches[1]]);
  });
});
