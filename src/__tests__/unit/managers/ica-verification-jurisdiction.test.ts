// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { describe, expect, it, jest } from '@jest/globals';
import { forwardOrganizationVerificationTransactionToIca } from '../../../managers/hosting/ica-verification';

const buildJob = (jurisdiction?: string) => ({
  jurisdiction,
  content: { body: {} },
}) as any;

const buildDependencies = (jurisdiction?: string, hostJurisdiction?: string) => ({
  job: buildJob(jurisdiction),
  entry: {},
  claims: {},
  resource: {},
  requestedSector: 'animal-care',
  resourceType: 'contract',
  organizationVerificationTransactionRequestType: 'Organization-verification-transaction-request-v1.0',
  icaDidcommPlainJsonMediaType: 'application/didcomm-plain+json',
  hostJurisdiction,
  hostDid: 'did:web:vet-gw.example.test',
  signHostAuthorizationPayload: jest.fn(async (_payload: Record<string, unknown>) => 'generated.proof.signature'),
  buildIcaVerifyUrl: jest.fn((_jurisdiction: string, _sector: string, _resourceType: string) => (
    'https://ica.example.test/verify'
  )),
  pollIcaJsonResult: jest.fn(async () => ({})),
  fetchImpl: jest.fn(async () => new Response('{}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as any,
});

describe('ICA verification jurisdiction resolution', () => {
  it('fails closed when neither the request nor host configuration declares a jurisdiction', async () => {
    const dependencies = buildDependencies();

    await expect(forwardOrganizationVerificationTransactionToIca(dependencies)).rejects.toThrow(
      /ICA verification jurisdiction is required/i,
    );
    expect(dependencies.buildIcaVerifyUrl).not.toHaveBeenCalled();
    expect(dependencies.fetchImpl).not.toHaveBeenCalled();
  });

  it('uses the configured host jurisdiction without substituting a country literal', async () => {
    const dependencies = buildDependencies(undefined, 'CA-BC');

    await forwardOrganizationVerificationTransactionToIca(dependencies);

    expect(dependencies.buildIcaVerifyUrl).toHaveBeenCalledWith('CA-BC', 'animal-care', 'contract');
  });

  it('binds a PDF-free ICA request to a host-signed route and resource payload', async () => {
    const dependencies = buildDependencies(undefined, 'CA-BC');

    await forwardOrganizationVerificationTransactionToIca(dependencies);

    expect(dependencies.signHostAuthorizationPayload).toHaveBeenCalledWith(expect.objectContaining({
      jurisdiction: 'CA-BC',
      sector: 'animal-care',
      resourceType: 'contract',
    }));
    const sent = JSON.parse(String(dependencies.fetchImpl.mock.calls[0]?.[1]?.body || '{}'));
    expect(sent.iss).toBe(dependencies.hostDid);
    expect(sent.body.hostAuthorizationProof).toEqual({ jws: 'generated.proof.signature' });
  });

  it('preserves a preauthorized proof and the exact resource covered by that proof', async () => {
    const dependencies = buildDependencies('CA-BC');
    const hostAuthorizationProof = { jws: 'protected.payload.signature' };
    const signedResource = { meta: { claims: { signed: 'unchanged' } } };
    dependencies.job.content.body = {
      hostAuthorizationProof,
      data: [{ resource: signedResource }],
    };

    await forwardOrganizationVerificationTransactionToIca(dependencies);

    const sent = JSON.parse(String(dependencies.fetchImpl.mock.calls[0]?.[1]?.body || '{}'));
    expect(sent.body.hostAuthorizationProof).toEqual(hostAuthorizationProof);
    expect(sent.body.data[0].resource).toEqual(signedResource);
    expect(dependencies.signHostAuthorizationPayload).not.toHaveBeenCalled();
  });

  it('fails closed when ICA polling returns a terminal failed verification inside a successful HTTP envelope', async () => {
    const dependencies = buildDependencies('CA-BC');
    dependencies.fetchImpl = jest.fn(async () => new Response('', {
      status: 202,
      headers: { location: 'https://ica.example.test/result' },
    })) as any;
    dependencies.pollIcaJsonResult = jest.fn(async () => ({
      body: {
        issues: { issue: [{ severity: 'error', diagnostics: 'credential ledger unavailable' }] },
        data: [{ resource: { status: 'failed' }, response: { status: '500' } }],
      },
    }));

    await expect(forwardOrganizationVerificationTransactionToIca(dependencies)).rejects.toThrow(
      /ICA verification failed.*credential ledger unavailable/i,
    );
  });
});
