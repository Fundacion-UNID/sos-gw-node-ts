// Flow contract: GW validates CSR input, forwards authenticated enrollment only to Fabric-CA, and projects its terminal result under entry.resource.
import { IcaManager } from '../../../managers/IcaManager';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { getEnvSectionId } from '../../../utils/section-env';

const makeJob = (body: any): JobRequest => ({
  id: 'job-1',
  tenantId: 'host',
  jurisdiction: 'es',
  sector: 'system',
  section: 'test-network',
  format: 'ica',
  resourceType: 'csr',
  action: '_enroll',
  sequence: 0,
  status: 'DRAFT' as any,
  createdAtTimestamp: Date.now(),
  content: {
    aud: 'did:web:host',
    iss: 'did:web:test-eur-ica.unid.online',
    jti: 'jti-1',
    thid: 'thid-1',
    type: 'ica-enroll-request',
    body,
    meta: {},
  },
});

describe('IcaManager', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.ICA_AUTO_APPROVE;
    delete process.env.ICA_FABRIC_CA_ENROLL_URL;
    delete process.env.ICA_FABRIC_CA_AUTH;
    delete process.env.ICA_MTLS_CERT_PEM;
    delete process.env.ICA_MTLS_KEY_PEM;
  });

  it('should reject missing CSR', async () => {
    const manager = new IcaManager();
    const response = await manager.process(makeJob({}));
    const entry = (response.body as any).data?.[0];
    expect(entry?.response?.status).toBe('400');
    expect(entry?.response?.outcome?.issue?.[0]?.diagnostics).toContain('Missing CSR');
  });

  it('should fail when auto-approve is enabled but enroll URL is missing (non-demo)', async () => {
    process.env.ICA_AUTO_APPROVE = 'true';
    process.env.NODE_ENV = 'development';
    const manager = new IcaManager();
    const response = await manager.process(makeJob({ csr: '---CSR---' }));
    const entry = (response.body as any).data?.[0];
    expect(entry?.response?.status).toBe('400');
    expect(entry?.response?.outcome?.issue?.[0]?.diagnostics).toContain('ICA_FABRIC_CA_ENROLL_URL');
  });

  it('should surface Fabric-CA errors when enroll fails', async () => {
    process.env.ICA_AUTO_APPROVE = 'true';
    process.env.ICA_FABRIC_CA_ENROLL_URL = 'https://test-eur-ica.unid.online/api/v1/enroll';
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => 'unavailable',
    })) as any;

    const manager = new IcaManager();
    const response = await manager.process(makeJob({ csr: '---CSR---' }));
    const entry = (response.body as any).data?.[0];
    expect(entry?.response?.status).toBe('500');
    expect(entry?.response?.outcome?.issue?.[0]?.diagnostics).toContain('Fabric-CA enroll failed');
  });

  it('should approve and return certificate when Fabric-CA succeeds', async () => {
    process.env.ICA_AUTO_APPROVE = 'true';
    process.env.ICA_FABRIC_CA_ENROLL_URL = 'https://test-eur-ica.unid.online/api/v1/enroll';
    process.env.ICA_FABRIC_CA_AUTH = 'Basic synthetic-test-credential';
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        result: { Cert: '---CERT---', Chain: ['---CHAIN---'], CAName: 'ica' },
      }),
    })) as any;

    const manager = new IcaManager();
    const response = await manager.process(makeJob({ csr: '---CSR---' }));
    const entry = (response.body as any).data?.[0];
    expect(entry?.resource?.status).toBe('approved');
    expect(entry?.resource?.certificate).toBe('---CERT---');
    expect(global.fetch).toHaveBeenCalledWith(
      process.env.ICA_FABRIC_CA_ENROLL_URL,
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: process.env.ICA_FABRIC_CA_AUTH }),
      }),
    );
  });

  it('should approve in demo mode without Fabric-CA', async () => {
    process.env.ICA_AUTO_APPROVE = 'true';
    process.env.NODE_ENV = 'demo';
    const manager = new IcaManager();
    const response = await manager.process(makeJob({ csr: '---CSR---' }));
    const entry = (response.body as any).data?.[0];
    expect(entry?.resource?.status).toBe('approved');
  });

  it('should derive mTLS from legacy X509 when no explicit mTLS is stored', async () => {
    process.env.ICA_AUTO_APPROVE = 'true';
    process.env.ICA_FABRIC_CA_ENROLL_URL = 'https://test-eur-ica.unid.online/api/v1/enroll';

    const legacyDerBase64 = Buffer.from('legacy-der-bytes').toString('base64');
    const vaultRepository = {
      get: jest.fn(async (_vaultId: string, id: string, section: string) => {
        if (section === getEnvSectionId('pki') && id === 'ica-mtls') return undefined;
        if (section === getEnvSectionId('tenants') && id === 'host') return { content: { legacyX509DerBase64: legacyDerBase64 } };
        return undefined;
      }),
    } as any;
    const kmsService = {
      unprotectConfidentialData: jest.fn(async (doc: any) => doc),
      getLegacyPrivateKeyPem: jest.fn(async () => '---PRIVATE-KEY---'),
    } as any;

    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ result: { Cert: '---CERT---' } }),
    })) as any;

    const manager = new IcaManager(vaultRepository, kmsService);
    const response = await manager.process(makeJob({ csr: '---CSR---' }));
    const entry = (response.body as any).data?.[0];
    expect(entry?.resource?.status).toBe('approved');
    expect(kmsService.getLegacyPrivateKeyPem).toHaveBeenCalledWith('host');
  });

});
