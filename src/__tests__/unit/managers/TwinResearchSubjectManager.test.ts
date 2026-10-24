// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// Public ResearchSubject search uses its private canonical Composition index and never returns the operational subject.
import { TwinCompositionManager } from '../../../managers/TwinCompositionManager';
import { getSubjectScopedSectionId } from '../../../utils/individual-sections';
import type { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { afterAll, beforeAll } from '@jest/globals';
import { SearchResponseProfileEnvironment, SearchResponseProfiles } from '../../../utils/didcomm-response';

describe('TwinCompositionManager public ResearchSubject search', () => {
  beforeAll(() => {
    process.env[SearchResponseProfileEnvironment.Variable] = SearchResponseProfiles.PrimaryResource;
  });
  afterAll(() => { delete process.env[SearchResponseProfileEnvironment.Variable]; });

  it('finds text across the private index and contains one typed canonical Composition in FHIR R4', async () => {
    const twinSubject = 'urn:uuid:00000000-0000-4000-8000-000000000123';
    const section = 'LOINC|10160-0';
    const medicationSection = getSubjectScopedSectionId(twinSubject, 'digitaltwin', 'medications');
    const compositionSection = getSubjectScopedSectionId(twinSubject, 'digitaltwin', 'composition');
    const vault = {
      getAllSections: jest.fn().mockResolvedValue([medicationSection, compositionSection]),
      listContainersInSection: jest.fn().mockImplementation(async (_vaultId: string, sectionId: string) => {
        if (sectionId === medicationSection) return [{
          id: 'medication-private-index',
          'MedicationStatement.subject': twinSubject,
          '__digitalTwinSearch.text': 'Tratamiento con ibuprofeno',
          '__digitalTwinSearch.date': '2026-08-20T10:00:00.000Z',
        }];
        if (sectionId === compositionSection) return [{
          id: 'composition-index',
          '__digitalTwinStudy.reference': 'https://research.example/studies/alpha',
          meta: {
            claims: {
              '@context': 'org.hl7.fhir.api',
              'org.hl7.fhir.api.Composition.subject': twinSubject,
              'org.hl7.fhir.api.Composition.section': section,
            },
            tag: [{ system: 'urn:research:tag:score', code: '10' }],
          },
        }];
        return [];
      }),
    } as unknown as jest.Mocked<IVaultRepository>;
    const manager = new TwinCompositionManager(vault);
    const request = {
      tenantId: 'acme', jurisdiction: 'CA-BC', sector: 'animal-care', section: 'digitaltwin',
      format: 'org.hl7.fhir.r4', resourceType: 'ResearchSubject', action: '_search',
      id: '', sequence: 0, status: 'DRAFT', createdAtTimestamp: Date.now(),
      content: {
        thid: 'research-subject-text-search', iss: 'did:web:researcher.example', aud: 'did:web:api.acme.org',
        body: {
          resourceType: 'Parameters',
          parameter: [
            { name: 'section', valueString: section },
            { name: 'date-from', valueDate: '2026-01-01' },
            { name: 'text', valueString: 'IBUPROFENO' },
          ],
        },
      },
    } as JobRequest;
    const response = await manager.process(request);

    expect((response.body as any).data[0].type).toBe('ResearchSubject-search-response-v1.0');
    expect((response.body as any).total).toBe(1);
    expect((response.body as any).data[0].resource).toMatchObject({
      resourceType: 'ResearchSubject',
      identifier: [{ value: twinSubject }],
      study: { reference: 'https://research.example/studies/alpha' },
      contained: [{
        resourceType: 'Composition',
        id: 'composition-index',
        subject: { reference: twinSubject },
        meta: { tag: [{ system: 'urn:research:tag:score', code: '10' }] },
      }],
    });
    expect((response.body as any).data[0].resource.composition).toBeUndefined();
    expect((response.body as any).data[0].resource.meta?.claims).toBeUndefined();
    expect(JSON.stringify((response.body as any).data[0].resource)).not.toContain('__digitalTwinStudy');

    const claimsFirstResponse = await manager.process({
      ...request,
      format: 'org.hl7.fhir.api',
      content: { ...request.content, thid: 'research-subject-claims-first-search' },
    } as JobRequest);
    const claimsFirstResource = (claimsFirstResponse.body as any).data[0].resource;
    expect(claimsFirstResource).toMatchObject({
      resourceType: 'ResearchSubject',
      meta: {
        claims: {
          '@context': 'org.hl7.fhir.api',
          'ResearchSubject.identifier': twinSubject,
          'ResearchSubject.study': 'https://research.example/studies/alpha',
          'Composition.subject': twinSubject,
          'Composition.section': section,
        },
      },
    });
    expect(claimsFirstResource.composition).toBeUndefined();
    expect(claimsFirstResource['Composition.subject']).toBeUndefined();
    expect(claimsFirstResource.meta.claims['__digitalTwinStudy.reference']).toBeUndefined();
  });
});
