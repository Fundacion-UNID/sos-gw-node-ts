// Flow contract: MedicationStatement writes remain claims-first, project only consented research data, preserve an uncoded medication text as user-selected=false, and surface terminology warnings without failing the operational write.
// MedicationStatement search uses the outer Bundle for 0..n
// results and returns no fictitious entry when the result count is zero.
import { afterAll, beforeAll, describe, expect, it, jest, beforeEach } from '@jest/globals';
import { MedicationStatementManager } from '../../../managers/MedicationStatementManager';
import { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { getSubjectScopedSectionId } from '../../../utils/individual-sections';
import { getEnvSectionId } from '../../../utils/section-env';
import { SearchResponseProfileEnvironment, SearchResponseProfiles } from '../../../utils/didcomm-response';
import {
  applyDigitalTwinSecondaryUseDecision,
  listEnabledDigitalTwinStudyTargets,
} from '../../../utils/digital-twin-secondary-use';
import { buildDemoResearchPermitByRoleConsent } from '../../data/demo-smart-access-local-network.data';
import { CompositionClaim, ConfidentialDocumentIndex } from 'gdc-common-utils-ts';
import {
  EXAMPLE_PROVIDER_ORGANIZATION_DID,
  EXAMPLE_SUBJECT_DID,
} from 'gdc-common-utils-ts/examples/shared';
import type { IBlockchainAdapter } from '../../../adapters/IBlockchainAdapter';

describe('MedicationStatementManager', () => {
  beforeAll(() => {
    process.env[SearchResponseProfileEnvironment.Variable] = SearchResponseProfiles.PrimaryResource;
  });
  afterAll(() => { delete process.env[SearchResponseProfileEnvironment.Variable]; });

  const storedRecords = new Map<string, any>();
  const mockVaultRepository = {
    vaultExists: jest.fn(),
    put: jest.fn(),
    query: jest.fn(),
    getAllSections: jest.fn(),
    listContainersInSection: jest.fn(),
    get: jest.fn(),
  } as unknown as jest.Mocked<IVaultRepository>;

  const manager = new MedicationStatementManager(mockVaultRepository);

  beforeEach(() => {
    jest.clearAllMocks();
    storedRecords.clear();
    mockVaultRepository.vaultExists.mockResolvedValue(true as any);
    mockVaultRepository.put.mockImplementation(async (vaultId: string, items: any[], sectionId?: string) => {
      items.forEach((item) => storedRecords.set(`${vaultId}|${sectionId}|${item.id}`, item));
      return true;
    });
    mockVaultRepository.get.mockImplementation(async (vaultId: string, id: string, sectionId?: string) =>
      storedRecords.get(`${vaultId}|${sectionId}|${id}`));
    mockVaultRepository.query.mockResolvedValue([] as any);
    mockVaultRepository.getAllSections.mockResolvedValue([] as any);
    mockVaultRepository.listContainersInSection.mockImplementation(async (vaultId: string, sectionId: string) =>
      Array.from(storedRecords.entries())
        .filter(([key]) => key.startsWith(`${vaultId}|${sectionId}|`))
        .map(([, record]) => record) as any);
  });

  const createBatchJob = (overrides: Partial<JobRequest> = {}): JobRequest => ({
    id: 'job-medication-1',
    status: JobStatus.DRAFT,
    sequence: 0,
    createdAtTimestamp: Date.now(),
    tenantId: 'acme',
    jurisdiction: 'es',
    sector: 'health-care',
    section: 'individual',
    format: 'org.hl7.fhir.api',
    resourceType: 'MedicationStatement',
    action: '_batch',
    content: {
      jti: 'jti-medication-1',
      thid: 'thid-medication-1',
      iss: 'did:web:app.example',
      aud: 'did:web:api.example',
      exp: Math.floor(Date.now() / 1000) + 300,
      type: 'org.hl7.fhir.api.Bundle',
      body: {
        resourceType: 'Bundle',
        type: 'batch',
        entry: [{
          type: 'MedicationStatement',
          resource: {
            resourceType: 'MedicationStatement',
            meta: { claims: {
              '@context': 'org.hl7.fhir.api',
              'MedicationStatement.subject': 'Organization/subject-001',
              'MedicationStatement.identifier': 'urn:uuid:med-001',
              'MedicationStatement.medication-text': 'Paracetamol',
              'MedicationStatement.code': 'http://www.nlm.nih.gov/research/umls/rxnorm|161',
              'MedicationStatement.status': 'active',
              [CompositionClaim.Author]: [
                EXAMPLE_PROVIDER_ORGANIZATION_DID,
                EXAMPLE_SUBJECT_DID,
              ].join(','),
              [CompositionClaim.Attester]: 'PractitionerRole/clinician-1',
              [CompositionClaim.AttesterMode]: 'professional',
            } },
          },
        }],
      },
    } as any,
    ...overrides,
  });

  it('stores MedicationStatement claims and returns polling location', async () => {
    const job = createBatchJob();
    const response = await manager.process(job);
    const data = (response.body as any).data;
    expect(data[0].response.status).toBe('201');
    expect(data[0].response.location).toBe(
      '/acme/cds-es/v1/health-care/individual/org.hl7.fhir.api/MedicationStatement/_batch-response',
    );

    const expectedSectionId = getSubjectScopedSectionId(
      'Organization/subject-001',
      'individual',
      'medications',
    );
    expect(mockVaultRepository.put).toHaveBeenCalled();
    const putArgs = (mockVaultRepository.put as any).mock.calls[0];
    expect(putArgs[0]).toBe('health-care_acme');
    expect(putArgs[2]).toBe(expectedSectionId);
    expect(putArgs[1][0].indexed.attributes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'org.hl7.fhir.api.MedicationStatement.subject', value: 'Organization/subject-001' }),
      expect.objectContaining({ name: 'org.hl7.fhir.api.MedicationStatement.medication-text', value: 'Paracetamol' }),
      expect.objectContaining({ name: 'org.hl7.fhir.api.MedicationStatement.code', value: 'http://www.nlm.nih.gov/research/umls/rxnorm|161' }),
      expect.objectContaining({ name: ConfidentialDocumentIndex.Sector, value: job.sector }),
      expect.objectContaining({ name: CompositionClaim.Author, value: EXAMPLE_PROVIDER_ORGANIZATION_DID }),
      expect.objectContaining({ name: CompositionClaim.Author, value: EXAMPLE_SUBJECT_DID }),
    ]));
  });

  it('supports _search by subject-scoped section and claim filters', async () => {
    mockVaultRepository.query.mockResolvedValueOnce([{ id: 'med-001' }] as any);
    const job = createBatchJob({ action: '_search' });
    const response = await manager.process(job);
    const data = (response.body as any).data;
    expect(data[0].response.status).toBe('200');
    expect((response.body as any).total).toBe(1);
    expect(data[0].resource.id).toBe('med-001');
    expect(data[0].resource.data).toBeUndefined();
    expect(mockVaultRepository.query).toHaveBeenCalled();
  });

  it('mirrors individual medication updates into the digitaltwin scope', async () => {
    await applyDigitalTwinSecondaryUseDecision({
      vaultRepository: mockVaultRepository,
      tenantVaultId: 'health-care_acme',
      claims: { ...buildDemoResearchPermitByRoleConsent({ subjectDid: 'Organization/subject-001' }) },
    });
    const [target] = await listEnabledDigitalTwinStudyTargets({
      vaultRepository: mockVaultRepository,
      tenantVaultId: 'health-care_acme',
      sourceSubject: 'Organization/subject-001',
    });
    const twinSubjectId = target.twinSubjectId;
    mockVaultRepository.put.mockClear();
    const job = createBatchJob();
    await manager.process(job);

    expect(mockVaultRepository.put).toHaveBeenCalledTimes(3);
    const digitalTwinSectionId = getSubjectScopedSectionId(twinSubjectId, 'digitaltwin', 'medications');
    const digitalTwinPutArgs = (mockVaultRepository.put as any).mock.calls.find((args: any[]) => args[2] === digitalTwinSectionId);
    expect(digitalTwinPutArgs[0]).toBe('health-care_acme');
    expect(digitalTwinPutArgs[2]).toBe(digitalTwinSectionId);
    const researchRecord = digitalTwinPutArgs[1][0];
    const subjectKey = Object.keys(researchRecord).find((key) => key.endsWith('MedicationStatement.subject'));
    expect(researchRecord[subjectKey as string]).toBe(twinSubjectId);
    expect(Object.keys(researchRecord).some((key) => key.endsWith('MedicationStatement.medication-text'))).toBe(false);
    const aliasUpdate = (mockVaultRepository.put as any).mock.calls.find((args: any[]) =>
      String(args[2]).includes('digitaltwin_subject_aliases') && args[1][0].lastSharedAt);
    expect(aliasUpdate?.[1][0].lastSharedAt).toEqual(expect.any(String));
  });

  it('registers a code-only research parent and opaque version after the private professional projection', async () => {
    await applyDigitalTwinSecondaryUseDecision({
      vaultRepository: mockVaultRepository,
      tenantVaultId: 'health-care_acme',
      claims: { ...buildDemoResearchPermitByRoleConsent({ subjectDid: 'Organization/subject-001' }) },
    });
    const registerResearchVersionMappings = jest.fn(async (
      _mappings: unknown[],
      _channel: string,
      _chaincode: string,
    ) => ({ accepted: 1, txId: 'tx-research-1' }));
    const blockchainAdapter = {
      discoverDidsByHashes: jest.fn(async () => []),
      registerResearchVersionMappings,
    } as unknown as IBlockchainAdapter;
    const registeringManager = new MedicationStatementManager(
      mockVaultRepository,
      undefined,
      blockchainAdapter,
    );

    const response = await registeringManager.process(createBatchJob());

    expect((response.body as any).data[0].response.status).toBe('201');
    expect(registerResearchVersionMappings).toHaveBeenCalledWith(
      [expect.objectContaining({
        resourceType: 'MedicationStatement',
        research: true,
        tags: [{
          id: 'MedicationStatement.code',
          system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
          code: '161',
        }],
      })],
      'health-care-eu-research',
      'artifact-sc',
    );
    expect(JSON.stringify(registerResearchVersionMappings.mock.calls[0])).not.toContain('Paracetamol');
  });

  it('keeps a personally attested medication out of the clinical research repository', async () => {
    await applyDigitalTwinSecondaryUseDecision({
      vaultRepository: mockVaultRepository,
      tenantVaultId: 'health-care_acme',
      claims: { ...buildDemoResearchPermitByRoleConsent({ subjectDid: 'Organization/subject-001' }) },
    });
    mockVaultRepository.put.mockClear();
    const job = createBatchJob();
    const claims = (job.content as any).body.entry[0].resource.meta.claims;
    claims[CompositionClaim.Attester] = 'RelatedPerson/family-1';
    claims[CompositionClaim.AttesterMode] = 'personal';

    await manager.process(job);

    expect(mockVaultRepository.put).toHaveBeenCalledTimes(1);
    expect((mockVaultRepository.put as any).mock.calls[0][2]).toContain('individual');
  });

  it('marks an uncoded medication for review, preserves only code-text, and returns a warning', async () => {
    await applyDigitalTwinSecondaryUseDecision({
      vaultRepository: mockVaultRepository,
      tenantVaultId: 'health-care_acme',
      claims: { ...buildDemoResearchPermitByRoleConsent({ subjectDid: 'Organization/subject-001' }) },
    });
    const [target] = await listEnabledDigitalTwinStudyTargets({
      vaultRepository: mockVaultRepository,
      tenantVaultId: 'health-care_acme',
      sourceSubject: 'Organization/subject-001',
    });
    const twinSubjectId = target.twinSubjectId;
    mockVaultRepository.put.mockClear();
    const job = createBatchJob();
    const claims = (job.content as any).body.entry[0].resource.meta.claims;
    delete claims['MedicationStatement.code'];
    delete claims['MedicationStatement.medication-text'];
    claims['MedicationStatement.code-text'] = 'Ibuprofeno';
    claims['MedicationStatement.user-selected'] = 'true';
    claims['MedicationStatement.language'] = 'es';

    const response = await manager.process(job);

    const digitalTwinSectionId = getSubjectScopedSectionId(twinSubjectId, 'digitaltwin', 'medications');
    const digitalTwinPutArgs = (mockVaultRepository.put as any).mock.calls.find((args: any[]) => args[2] === digitalTwinSectionId);
    const researchRecord = digitalTwinPutArgs[1][0];
    const researchClaim = (suffix: string) => researchRecord[
      Object.keys(researchRecord).find((key) => key.endsWith(suffix)) as string
    ];
    expect(researchClaim('MedicationStatement.code')).toBeUndefined();
    expect(researchClaim('MedicationStatement.code-text')).toBe('Ibuprofeno');
    expect(researchClaim('MedicationStatement.user-selected')).toBe('false');
    expect((response.body as any).data[0].response).toMatchObject({
      status: '201',
      outcome: { issue: [{ severity: 'warning', code: 'incomplete' }] },
    });
  });

  it('returns a retryable application warning when exact code label resolution fails', async () => {
    await applyDigitalTwinSecondaryUseDecision({
      vaultRepository: mockVaultRepository,
      tenantVaultId: 'health-care_acme',
      claims: { ...buildDemoResearchPermitByRoleConsent({ subjectDid: 'Organization/subject-001' }) },
    });
    process.env.RESEARCH_TERMINOLOGY_BASE_URL = 'https://terminology.example';
    process.env.RESEARCH_TERMINOLOGY_LABELS_ENABLED = 'true';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 503 } as Response);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await manager.process(createBatchJob());
      expect((response.body as any).data[0].response).toMatchObject({
        status: '201',
        outcome: { issue: [{ severity: 'warning', code: 'processing' }] },
      });
    } finally {
      delete process.env.RESEARCH_TERMINOLOGY_BASE_URL;
      delete process.env.RESEARCH_TERMINOLOGY_LABELS_ENABLED;
      fetchSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('does not search digital twin medications by free text', async () => {
    const job = createBatchJob({
      action: '_search',
      section: 'digitaltwin',
      content: {
        thid: 'thid-digitaltwin-search-001',
        iss: 'did:web:app.example',
        aud: 'did:web:api.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.api.Bundle',
        body: {
          data: [
            {
              type: 'MedicationStatement-search-request-v1.0',
              resource: {
                resourceType: 'MedicationStatement',
                meta: { claims: {
                  '@context': 'org.hl7.fhir.api',
                  'MedicationStatement.medication-text': 'paracetamol',
                } },
              },
            },
          ],
        },
      } as any,
    });

    const response = await manager.process(job);
    const data = (response.body as any).data;
    expect((response.body as any).total).toBe(0);
    expect(data).toEqual([]);
    expect(mockVaultRepository.getAllSections).not.toHaveBeenCalled();
  });

  it('searches digital twin medications across subjects by exact medication code', async () => {
    mockVaultRepository.getAllSections.mockResolvedValueOnce([
      getEnvSectionId('digitaltwin_medications_hash-a'),
    ] as any);
    mockVaultRepository.listContainersInSection.mockResolvedValueOnce([
      {
        id: 'med-a',
        'MedicationStatement.subject': 'did:web:example:subject:a',
        'MedicationStatement.code': 'http://www.nlm.nih.gov/research/umls/rxnorm|161',
        indexed: { attributes: [{ name: 'MedicationStatement.code', value: 'http://www.nlm.nih.gov/research/umls/rxnorm|161' }] },
      },
    ] as any);

    const job = createBatchJob({
      action: '_search',
      section: 'digitaltwin',
      content: {
        thid: 'thid-digitaltwin-search-code-001',
        iss: 'did:web:app.example',
        aud: 'did:web:api.example',
        exp: Math.floor(Date.now() / 1000) + 300,
        type: 'org.hl7.fhir.api.Bundle',
        body: {
          data: [
            {
              type: 'MedicationStatement-search-request-v1.0',
              resource: {
                resourceType: 'MedicationStatement',
                meta: { claims: {
                  '@context': 'org.hl7.fhir.api',
                  'MedicationStatement.code': 'http://www.nlm.nih.gov/research/umls/rxnorm|161',
                } },
              },
            },
          ],
        },
      } as any,
    });

    const response = await manager.process(job);
    const data = (response.body as any).data;
    expect(data[0].response.status).toBe('200');
    expect((response.body as any).total).toBe(1);
    expect(data[0].resource.id).toBe('med-a');
    expect(data[0].resource.data).toBeUndefined();
  });
});
