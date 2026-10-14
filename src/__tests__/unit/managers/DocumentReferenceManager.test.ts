// Flow contract: DocumentReference writes keep logical identifiers separate from CID evidence and derive ledger routing from trusted job context.
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/managers/DocumentReferenceManager.test.ts

import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { DocumentReferenceManager } from '../../../managers/DocumentReferenceManager';
import { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { getIndividualSectionId } from '../../../utils/individual-sections';
import { ClinicalEvidenceChaincode, resolveClinicalDataChannel } from '../../../utils/ledger';

describe('DocumentReferenceManager', () => {
  const mockVaultRepository = {
    vaultExists: jest.fn(),
    put: jest.fn(),
  } as unknown as jest.Mocked<IVaultRepository>;

  const mockBlockchainAdapter = {
    registerCidVersionMappings: jest.fn(),
    registerArtifactBundle: jest.fn(),
  } as any;

  const manager = new DocumentReferenceManager(mockVaultRepository, mockBlockchainAdapter);

  beforeEach(() => {
    jest.clearAllMocks();
    mockVaultRepository.vaultExists.mockResolvedValue(true as any);
    mockVaultRepository.put.mockResolvedValue(true as any);
  });

  const createJob = (claims: Record<string, any>): JobRequest => ({
    id: 'job-docref-1',
    status: JobStatus.DRAFT,
    sequence: 0,
    createdAtTimestamp: Date.now(),
    tenantId: 'acme',
    jurisdiction: 'es',
    sector: 'health-care',
    section: 'individual',
    format: 'org.hl7.fhir.r4',
    resourceType: 'DocumentReference',
    action: '_batch',
    content: {
      jti: 'jti-1',
      thid: 'thid-1',
      iss: 'did:web:app.example',
      aud: 'did:web:api.example',
      exp: Math.floor(Date.now() / 1000) + 300,
      type: 'org.hl7.fhir.r4.Bundle',
      body: {
        resourceType: 'Bundle',
        type: 'batch',
        entry: [{
          type: 'DocumentReference',
          resource: { resourceType: 'DocumentReference', meta: { claims } },
        }],
      } as any,
    } as any,
  });

  it('stores DocumentReference claims in per-subject section and returns 201', async () => {
    const subject = 'did:web:api.acme.org:individual:123';
    const job = createJob({
      '@context': 'org.hl7.fhir.r4',
      'DocumentReference.subject': subject,
      'DocumentReference.identifier': 'urn:uuid:docref-001',
      'DocumentReference.category': 'http://loinc.org|11502-2',
      'DocumentReference.content-attachment-type': 'application/pdf',
      'DocumentReference.content-attachment-data': 'JVBERi0xLjQKJ...',
    });

    const response = await manager.process(job);
    expect(response.body?.resourceType).toBe('Bundle');
    const data = (response.body as any).data;
    expect(data[0].response.status).toBe('201');
    expect(data[0].response.location).toBe(
      '/acme/cds-es/v1/health-care/individual/org.hl7.fhir.r4/DocumentReference/_batch-response'
    );
    expect(data[0].response.location).not.toMatch(/\/DocumentReference\/[0-9a-f]{8,}/i);

    const sectionId = getIndividualSectionId(subject, 'document-references');
    expect(mockVaultRepository.put).toHaveBeenCalled();
    const putArgs = (mockVaultRepository.put as any).mock.calls[0];
    expect(putArgs[0]).toBe('health-care_acme');
    expect(putArgs[2]).toBe(sectionId);
  });

  it('returns 400 when DocumentReference.subject is missing', async () => {
    const job = createJob({
      '@context': 'org.hl7.fhir.r4',
      'DocumentReference.identifier': 'urn:uuid:docref-001',
    });

    const response = await manager.process(job);
    const data = (response.body as any).data;
    expect(data[0].response.status).toBe('400');
    expect(data[0].response.outcome.issue[0].diagnostics).toContain('DocumentReference.subject');
    expect(mockVaultRepository.put).not.toHaveBeenCalled();
  });

  // This test proves the backend contract for attachment/document writes:
  // the vault write remains local, while the CID-backed artifact is also
  // published through the blockchain adapter with the business identifier kept
  // separate from the content hash.
  it('registers content-addressed CID mappings on the blockchain adapter', async () => {
    const subject = 'did:web:api.acme.org:individual:321';
    const job = createJob({
      '@context': 'org.hl7.fhir.r4',
      'DocumentReference.subject': subject,
      'DocumentReference.identifier': 'urn:uuid:docref-002',
      'DocumentReference.contenttype': 'application/pdf',
      'DocumentReference.contentdata': Buffer.from('%PDF-1.4', 'utf8').toString('base64'),
    });

    await manager.process(job);

    expect(mockBlockchainAdapter.registerCidVersionMappings).toHaveBeenCalledTimes(1);
    expect(mockBlockchainAdapter.registerArtifactBundle).toHaveBeenCalledTimes(1);
    const [mappings, channel, chaincode] = mockBlockchainAdapter.registerCidVersionMappings.mock.calls[0];
    expect(channel).toBe(resolveClinicalDataChannel(job.sector, job.jurisdiction));
    expect(chaincode).toBe(ClinicalEvidenceChaincode);
    expect(mappings[0].resourceType).toBe('DocumentReference');
    expect(mappings[0].versionId.startsWith('z')).toBe(true);
    expect(mappings[0].cid).toBe(mappings[0].versionId);
    expect(mappings[0].resourceId).toBeDefined();

    const [artifactParams] = mockBlockchainAdapter.registerArtifactBundle.mock.calls[0];
    expect(artifactParams.assetId).toBe(mappings[0].cid);
    expect(artifactParams.payload.resourceType).toBe('DocumentReference');
    expect(artifactParams.payload.subject).toBe(subject);
  });
});
